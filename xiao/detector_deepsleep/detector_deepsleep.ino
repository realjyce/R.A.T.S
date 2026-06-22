/*
 * R.A.T.S — XIAO ESP32-S3 Sense  ·  DEEP-SLEEP demo firmware
 *
 * Battery-scenario variant of detector.ino. Proves real-world power/cost saving:
 *   • Sleeps in deep sleep (~14 µA) until the PIR AM312 sees motion.
 *   • PIR HIGH on GPIO2 wakes the chip (ext0). It boots, runs FOMO, serves
 *     /status + /capture, and pushes counts to the dashboard.
 *   • After AWAKE_HOLD_MS with no motion it deep-sleeps again.
 *   • It accumulates AWAKE time and TOTAL elapsed time in RTC memory (survives
 *     deep sleep) and POSTs them to the backend so the dashboard "Power &
 *     Savings" panel projects battery life + cost from the REAL duty cycle.
 *
 * Wiring (see PIR-Mode.md): AM312 VCC->3V3, GND->GND, OUT->D1/GPIO2.
 * Board: XIAO_ESP32S3 | PSRAM: OPI PSRAM | Partition: Huge APP.
 *
 * NOTE: deep sleep kills WiFi, so the device is unreachable while asleep — by
 * design. The power panel reads from the BACKEND (which keeps the last push),
 * so it stays live across sleep. For an always-on live dashboard use detector.ino.
 */

#include <RATS_FOMO_v1_inferencing.h>
#include "edge-impulse-sdk/dsp/image/image.hpp"

#include "esp_camera.h"
#include "esp_sleep.h"
#include "esp_timer.h"
#include <sys/time.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>

SET_LOOP_TASK_STACK_SIZE(16 * 1024);

/* ── User config ─────────────────────────────────────────────────────────── */
const char* ssid        = "SK_06D0_2.4G";
const char* password    = "AAB2F@2515";
// The PC running server.py (python server.py on :5000). Use its LAN IP.
const char* BACKEND_URL = "http://192.168.0.100:5000/xiao/push";

#define PIR_GPIO        GPIO_NUM_2   // D1, RTC-capable → valid ext0 wake source
#define AWAKE_HOLD_MS   15000        // stay awake this long after the last motion
#define PIR_WARMUP_MS   30000        // AM312 settle time, COLD BOOT only
#define INFER_INTERVAL_MS 700
#define DET_THRESHOLD   0.60f

/* ── Persists across deep sleep (RTC slow memory) ────────────────────────── */
RTC_DATA_ATTR uint32_t rtc_boot_count = 0;
RTC_DATA_ATTR uint64_t rtc_awake_us   = 0;   // accumulated time spent awake

static uint64_t wake_start_us = 0;           // esp_timer at this wake

/* ── Camera pins — XIAO ESP32-S3 Sense ───────────────────────────────────── */
#define PWDN_GPIO_NUM  -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM  10
#define SIOD_GPIO_NUM  40
#define SIOC_GPIO_NUM  39
#define Y9_GPIO_NUM    48
#define Y8_GPIO_NUM    11
#define Y7_GPIO_NUM    12
#define Y6_GPIO_NUM    14
#define Y5_GPIO_NUM    16
#define Y4_GPIO_NUM    18
#define Y3_GPIO_NUM    17
#define Y2_GPIO_NUM    15
#define VSYNC_GPIO_NUM 38
#define HREF_GPIO_NUM  47
#define PCLK_GPIO_NUM  13

static bool     debug_nn      = false;
static bool     camera_ready  = false;
static uint8_t* snapshot_buf  = nullptr;
static uint32_t last_infer_ms = 0;
static uint32_t last_motion_ms = 0;

#define MAX_CLASSES 8
static int      latest_count[MAX_CLASSES] = {0};
static uint32_t latest_latency_ms = 0;
static int      latest_total_objects = 0;
static uint32_t latest_fbw = 0, latest_fbh = 0;

static const camera_config_t camera_config = {
  .pin_pwdn = PWDN_GPIO_NUM, .pin_reset = RESET_GPIO_NUM, .pin_xclk = XCLK_GPIO_NUM,
  .pin_sccb_sda = SIOD_GPIO_NUM, .pin_sccb_scl = SIOC_GPIO_NUM,
  .pin_d7 = Y9_GPIO_NUM, .pin_d6 = Y8_GPIO_NUM, .pin_d5 = Y7_GPIO_NUM, .pin_d4 = Y6_GPIO_NUM,
  .pin_d3 = Y5_GPIO_NUM, .pin_d2 = Y4_GPIO_NUM, .pin_d1 = Y3_GPIO_NUM, .pin_d0 = Y2_GPIO_NUM,
  .pin_vsync = VSYNC_GPIO_NUM, .pin_href = HREF_GPIO_NUM, .pin_pclk = PCLK_GPIO_NUM,
  .xclk_freq_hz = 20000000, .ledc_timer = LEDC_TIMER_0, .ledc_channel = LEDC_CHANNEL_0,
  .pixel_format = PIXFORMAT_JPEG, .frame_size = FRAMESIZE_VGA,
  .jpeg_quality = 12, .fb_count = 1, .fb_location = CAMERA_FB_IN_PSRAM,
  .grab_mode = CAMERA_GRAB_WHEN_EMPTY,
};

WebServer server(80);

/* ── Camera (same pipeline as detector.ino) ──────────────────────────────── */
bool ei_camera_init() {
  if (esp_camera_init(&camera_config) != ESP_OK) return false;
  sensor_t* s = esp_camera_sensor_get();
  if (s) { s->set_vflip(s, 1); s->set_brightness(s, 1); }
  return true;
}

bool ei_camera_capture(uint32_t img_width, uint32_t img_height) {
  if (!camera_ready) return false;
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) return false;
  uint32_t fbw = fb->width, fbh = fb->height;
  latest_fbw = fbw; latest_fbh = fbh;
  size_t raw_len = (size_t)fbw * fbh * 3;
  snapshot_buf = (uint8_t*)ps_malloc(raw_len);
  if (!snapshot_buf) { esp_camera_fb_return(fb); return false; }
  bool ok = fmt2rgb888(fb->buf, fb->len, PIXFORMAT_JPEG, snapshot_buf);
  esp_camera_fb_return(fb);
  if (!ok) { free(snapshot_buf); snapshot_buf = nullptr; return false; }
  if (fbw != img_width || fbh != img_height) {
    ei::image::processing::crop_and_interpolate_rgb888(
      snapshot_buf, fbw, fbh, snapshot_buf, img_width, img_height);
  }
  return true;
}

static int ei_camera_get_data(size_t offset, size_t length, float* out_ptr) {
  size_t pixel_ix = offset * 3, out_ix = 0;
  while (length--) {
    out_ptr[out_ix++] = (snapshot_buf[pixel_ix + 2] << 16) +
                        (snapshot_buf[pixel_ix + 1] << 8) + snapshot_buf[pixel_ix];
    pixel_ix += 3;
  }
  return 0;
}

void run_inference() {
  if (!ei_camera_capture(EI_CLASSIFIER_INPUT_WIDTH, EI_CLASSIFIER_INPUT_HEIGHT)) return;
  ei::signal_t signal;
  signal.total_length = EI_CLASSIFIER_INPUT_WIDTH * EI_CLASSIFIER_INPUT_HEIGHT;
  signal.get_data = &ei_camera_get_data;
  ei_impulse_result_t result = {0};
  if (run_classifier(&signal, &result, debug_nn) != EI_IMPULSE_OK) {
    free(snapshot_buf); snapshot_buf = nullptr; return;
  }
  int counts[MAX_CLASSES] = {0}, total = 0;
#if EI_CLASSIFIER_OBJECT_DETECTION == 1
  for (uint32_t i = 0; i < result.bounding_boxes_count; i++) {
    ei_impulse_result_bounding_box_t bb = result.bounding_boxes[i];
    if (bb.value < DET_THRESHOLD) continue;
    total++;
    for (uint16_t c = 0; c < EI_CLASSIFIER_LABEL_COUNT && c < MAX_CLASSES; c++)
      if (strcmp(bb.label, ei_classifier_inferencing_categories[c]) == 0) { counts[c]++; break; }
  }
#endif
  for (int c = 0; c < MAX_CLASSES; c++) latest_count[c] = counts[c];
  latest_total_objects = total;
  latest_latency_ms = result.timing.dsp + result.timing.classification;
  Serial.printf("objects: %d | %ums\n", total, latest_latency_ms);
  free(snapshot_buf); snapshot_buf = nullptr;
}

/* ── Telemetry: total elapsed wall-time persists in the RTC clock across deep
 *    sleep, so gettimeofday() keeps counting from the first cold boot. ─────── */
static uint64_t now_us() {
  struct timeval tv; gettimeofday(&tv, NULL);
  return (uint64_t)tv.tv_sec * 1000000ULL + tv.tv_usec;
}

String counts_json() {
  String j = "{";
  for (uint16_t c = 0; c < EI_CLASSIFIER_LABEL_COUNT && c < MAX_CLASSES; c++) {
    if (c) j += ",";
    j += "\""; j += ei_classifier_inferencing_categories[c]; j += "\":" + String(latest_count[c]);
  }
  return j + "}";
}

// POST accumulated power telemetry to the backend. 'event' is "wake" or "sleep".
void push_power(const char* event) {
  if (WiFi.status() != WL_CONNECTED) return;
  uint64_t awake = rtc_awake_us;
  if (strcmp(event, "sleep") == 0) awake += esp_timer_get_time() - wake_start_us;
  String body = "{\"event\":\"" + String(event) + "\"";
  body += ",\"boot_count\":" + String(rtc_boot_count);
  body += ",\"awake_us\":" + String((uint32_t)(awake / 1000ULL)) + "000"; // keep within String range
  body += ",\"total_us\":" + String((uint32_t)(now_us() / 1000ULL)) + "000";
  body += ",\"counts\":" + counts_json() + "}";
  HTTPClient http;
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(body);
  Serial.printf("push %s -> %d\n", event, code);
  http.end();
}

/* ── Web handlers (live only while awake) ────────────────────────────────── */
void handleStatus() {
  String json = "{\"counts\":" + counts_json();
  json += ",\"objects\":" + String(latest_total_objects);
  json += ",\"latency\":" + String(latest_latency_ms);
  json += ",\"w\":" + String(latest_fbw) + ",\"h\":" + String(latest_fbh);
  json += ",\"state\":\"awake\",\"wake\":" + String(rtc_boot_count) + "}";
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}
void handleCapture() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { server.send(500, "text/plain", "Capture failed"); return; }
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

/* ── Sleep ───────────────────────────────────────────────────────────────── */
void go_to_sleep() {
  rtc_awake_us += esp_timer_get_time() - wake_start_us;  // bank this awake window
  push_power("sleep");                                   // last word before going dark

  // ext0 fires while the pin is HIGH — wait for motion to clear, or we'd wake
  // instantly. (AM312 holds OUT high for ~2s after motion.)
  Serial.println("No motion — entering deep sleep");
  while (digitalRead(PIR_GPIO) == HIGH) delay(50);
  esp_sleep_enable_ext0_wakeup(PIR_GPIO, 1);             // wake on next PIR HIGH
  Serial.flush();
  esp_deep_sleep_start();                                // → reboots into setup() on wake
}

/* ── Setup / loop ────────────────────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(300);
  wake_start_us = esp_timer_get_time();

  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  bool cold_boot = (cause != ESP_SLEEP_WAKEUP_EXT0);
  if (cold_boot) { rtc_boot_count = 0; rtc_awake_us = 0; }
  rtc_boot_count++;
  Serial.printf("\n=== R.A.T.S Deep-Sleep === wake #%u  (%s)\n",
                rtc_boot_count, cold_boot ? "cold boot" : "PIR wake");

  pinMode(PIR_GPIO, INPUT);

  if (!psramFound()) { Serial.println("ERR: PSRAM not found"); while (1); }
  camera_ready = ei_camera_init();
  if (!camera_ready) { Serial.println("ERR: camera init"); while (1); }

  WiFi.begin(ssid, password);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("IP: "); Serial.println(WiFi.localIP());
    server.on("/status", handleStatus);
    server.on("/capture", handleCapture);
    server.begin();
    push_power("wake");           // announce we're up (marks state AWAKE on dashboard)
  } else {
    Serial.println("WiFi failed — inference only this wake");
  }

  // On a cold power-up the AM312 needs to settle; ignore it briefly so we don't
  // immediately re-sleep on a boot-time false trigger.
  if (cold_boot) { Serial.println("AM312 warm-up…"); delay(PIR_WARMUP_MS); }
  last_motion_ms = millis();
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) server.handleClient();

  if (digitalRead(PIR_GPIO) == HIGH) last_motion_ms = millis();  // recent motion

  if (millis() - last_infer_ms >= INFER_INTERVAL_MS) {
    last_infer_ms = millis();
    run_inference();
  }

  if (millis() - last_motion_ms >= AWAKE_HOLD_MS) go_to_sleep();
}
