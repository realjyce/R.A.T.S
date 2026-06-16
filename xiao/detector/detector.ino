/*
 * R.A.T.S — XIAO ESP32-S3 Sense on-device FOMO detector
 *
 * Runs the Edge Impulse FOMO model on-device and exposes:
 *   GET /          -> simple status page
 *   GET /status    -> JSON  {"counts":{"bottle":N,...}, "latency":ms, "objects":N}
 *   GET /capture   -> single JPEG snapshot (for dashboard preview)
 *
 * Board:  XIAO_ESP32S3   |   PSRAM: OPI PSRAM   |   Partition: Huge APP
 *
 * NOTE: continuous MJPEG /stream is intentionally omitted for v1 — the
 * synchronous WebServer can't stream AND answer /status at the same time.
 * The dashboard can poll /capture for a refreshing preview instead.
 */

/* Edge Impulse model ------------------------------------------------------ */
#include <RATS_FOMO_v1_inferencing.h>
#include "edge-impulse-sdk/dsp/image/image.hpp"

/* ESP32 + networking ------------------------------------------------------ */
#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>

// Give the Arduino loop task a bigger stack — run_classifier (TFLite Micro)
// needs more than the default 8 KB. Must be at global scope.
SET_LOOP_TASK_STACK_SIZE(16 * 1024);

// Set to 0 to test inference ALONE (no WiFi/server) for crash isolation.
#define ENABLE_WIFI 1

/* WiFi credentials -------------------------------------------------------- */
const char* ssid     = "SK_06D0_2.4G";
const char* password = "AAB2F@2515";

WebServer server(80);

/* Camera pins — XIAO ESP32-S3 Sense -------------------------------------- */
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

/* Raw camera capture size (before crop/resize to model input) ------------- */
#define EI_CAMERA_RAW_FRAME_BUFFER_COLS 320
#define EI_CAMERA_RAW_FRAME_BUFFER_ROWS 240
#define EI_CAMERA_FRAME_BYTE_SIZE       3

static bool     debug_nn       = false;
static bool     camera_ready   = false;
static uint8_t* snapshot_buf   = nullptr;  // allocated/freed each inference
static uint32_t last_infer_ms  = 0;
#define INFER_INTERVAL_MS 700
#define DET_THRESHOLD     0.60f   // ignore detections weaker than this (reduces flicker)

/* Latest inference result, shared with the web handlers ------------------- */
#define MAX_CLASSES 8
#define MAX_DETS    24
struct Det { int x1, y1, x2, y2; char label[16]; float conf; };
static int      latest_count[MAX_CLASSES] = {0};
static uint32_t latest_latency_ms = 0;
static int      latest_total_objects = 0;
static Det      latest_dets[MAX_DETS];          // boxes in FRAME pixel coords
static int      latest_det_count = 0;
static uint32_t latest_fbw = 0, latest_fbh = 0; // last frame size (preview space)

static const camera_config_t camera_config = {
  .pin_pwdn     = PWDN_GPIO_NUM,
  .pin_reset    = RESET_GPIO_NUM,
  .pin_xclk     = XCLK_GPIO_NUM,
  .pin_sccb_sda = SIOD_GPIO_NUM,
  .pin_sccb_scl = SIOC_GPIO_NUM,
  .pin_d7       = Y9_GPIO_NUM,
  .pin_d6       = Y8_GPIO_NUM,
  .pin_d5       = Y7_GPIO_NUM,
  .pin_d4       = Y6_GPIO_NUM,
  .pin_d3       = Y5_GPIO_NUM,
  .pin_d2       = Y4_GPIO_NUM,
  .pin_d1       = Y3_GPIO_NUM,
  .pin_d0       = Y2_GPIO_NUM,
  .pin_vsync    = VSYNC_GPIO_NUM,
  .pin_href     = HREF_GPIO_NUM,
  .pin_pclk     = PCLK_GPIO_NUM,
  .xclk_freq_hz = 20000000,
  .ledc_timer   = LEDC_TIMER_0,
  .ledc_channel = LEDC_CHANNEL_0,
  .pixel_format = PIXFORMAT_JPEG,   // decoded to RGB888 for inference
  .frame_size   = FRAMESIZE_VGA,    // 640x480 — match training capture (bottle.ino)
  .jpeg_quality = 12,
  .fb_count     = 1,
  .fb_location  = CAMERA_FB_IN_PSRAM,
  .grab_mode    = CAMERA_GRAB_WHEN_EMPTY,
};

/* ------------------------------------------------------------------------ */
/* Camera                                                                    */
/* ------------------------------------------------------------------------ */
bool ei_camera_init() {
  esp_err_t err = esp_camera_init(&camera_config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }
  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    s->set_vflip(s, 1);       // XIAO Sense camera is mounted upside-down
    s->set_brightness(s, 1);
  }
  return true;
}

// Capture one frame, decode JPEG -> RGB888, crop/resize to model input.
// Allocates the global snapshot_buf sized to the ACTUAL frame so the JPEG
// decode can never overflow it. Caller frees snapshot_buf after inference.
bool ei_camera_capture(uint32_t img_width, uint32_t img_height) {
  if (!camera_ready) return false;

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Camera capture failed");
    return false;
  }

  uint32_t fbw = fb->width;
  uint32_t fbh = fb->height;
  latest_fbw = fbw;
  latest_fbh = fbh;

  static bool printed = false;
  if (!printed) {
    Serial.printf("frame: %ux%u  fmt=%d  jpeg_len=%u  (model wants %ux%u)\n",
                  fbw, fbh, fb->format, fb->len, img_width, img_height);
    printed = true;
  }

  // Decode the full JPEG frame into ONE buffer sized to the whole frame.
  // crop_and_interpolate needs room for its intermediate center-crop, so the
  // destination must be the full-frame buffer and the resize is done IN PLACE
  // (this is the tested Edge Impulse pattern).
  size_t raw_len = (size_t)fbw * fbh * 3;
  snapshot_buf = (uint8_t*)ps_malloc(raw_len);
  if (!snapshot_buf) {
    Serial.println("ERR: ps_malloc snapshot_buf failed");
    esp_camera_fb_return(fb);
    return false;
  }

  bool converted = fmt2rgb888(fb->buf, fb->len, PIXFORMAT_JPEG, snapshot_buf);
  esp_camera_fb_return(fb);
  if (!converted) {
    Serial.println("JPEG -> RGB888 failed");
    free(snapshot_buf);
    snapshot_buf = nullptr;
    return false;
  }

  // Crop/resize the full frame down to the model input, in place.
  if (fbw != img_width || fbh != img_height) {
    ei::image::processing::crop_and_interpolate_rgb888(
      snapshot_buf, fbw, fbh,
      snapshot_buf, img_width, img_height);
  }
  return true;
}

// EI signal callback: pack RGB888 bytes into 0xRRGGBB floats.
static int ei_camera_get_data(size_t offset, size_t length, float* out_ptr) {
  size_t pixel_ix = offset * 3;
  size_t out_ix = 0;
  while (length--) {
    // Swap BGR -> RGB (esp32-camera quirk, see EI example)
    out_ptr[out_ix] = (snapshot_buf[pixel_ix + 2] << 16) +
                      (snapshot_buf[pixel_ix + 1] << 8) +
                      snapshot_buf[pixel_ix];
    out_ix++;
    pixel_ix += 3;
  }
  return 0;
}

/* ------------------------------------------------------------------------ */
/* Inference                                                                 */
/* ------------------------------------------------------------------------ */
void run_inference() {
  // Capture allocates snapshot_buf (sized to the real frame); we free it below.
  if (!ei_camera_capture(EI_CLASSIFIER_INPUT_WIDTH,
                         EI_CLASSIFIER_INPUT_HEIGHT)) {
    return;
  }

  ei::signal_t signal;
  signal.total_length = EI_CLASSIFIER_INPUT_WIDTH * EI_CLASSIFIER_INPUT_HEIGHT;
  signal.get_data = &ei_camera_get_data;

  ei_impulse_result_t result = {0};
  EI_IMPULSE_ERROR err = run_classifier(&signal, &result, debug_nn);
  if (err != EI_IMPULSE_OK) {
    Serial.printf("run_classifier failed (%d)\n", err);
    free(snapshot_buf);
    snapshot_buf = nullptr;
    return;
  }

  int counts[MAX_CLASSES] = {0};
  int total = 0;
  int dcount = 0;

  // Inverse of the center-crop done in capture: the square model input came
  // from cropping the frame to min(fbw,fbh) centered, then scaling to 96.
  uint32_t crop  = (latest_fbw < latest_fbh) ? latest_fbw : latest_fbh;
  int      offx  = (int)(latest_fbw - crop) / 2;
  int      offy  = (int)(latest_fbh - crop) / 2;
  float    scale = (float)crop / (float)EI_CLASSIFIER_INPUT_WIDTH;  // input is square

#if EI_CLASSIFIER_OBJECT_DETECTION == 1
  for (uint32_t i = 0; i < result.bounding_boxes_count; i++) {
    ei_impulse_result_bounding_box_t bb = result.bounding_boxes[i];
    if (bb.value < DET_THRESHOLD) continue;   // skip empty + weak detections
    total++;
    // tally by class index
    for (uint16_t c = 0; c < EI_CLASSIFIER_LABEL_COUNT && c < MAX_CLASSES; c++) {
      if (strcmp(bb.label, ei_classifier_inferencing_categories[c]) == 0) {
        counts[c]++;
        break;
      }
    }
    // map model-space box -> frame (preview) pixel coords
    if (dcount < MAX_DETS) {
      latest_dets[dcount].x1 = offx + (int)(bb.x * scale);
      latest_dets[dcount].y1 = offy + (int)(bb.y * scale);
      latest_dets[dcount].x2 = offx + (int)((bb.x + bb.width)  * scale);
      latest_dets[dcount].y2 = offy + (int)((bb.y + bb.height) * scale);
      strncpy(latest_dets[dcount].label, bb.label, sizeof(latest_dets[dcount].label) - 1);
      latest_dets[dcount].label[sizeof(latest_dets[dcount].label) - 1] = '\0';
      latest_dets[dcount].conf = bb.value;
      dcount++;
    }
    Serial.printf("  %s (%.2f) @ x:%u y:%u\n", bb.label, bb.value, bb.x, bb.y);
  }
#endif

  // publish to the shared globals for the web handlers (single-threaded loop)
  for (int c = 0; c < MAX_CLASSES; c++) latest_count[c] = counts[c];
  latest_det_count = dcount;
  latest_total_objects = total;
  latest_latency_ms = result.timing.dsp + result.timing.classification;

  Serial.printf("objects: %d  | %ums\n", total, latest_latency_ms);

  free(snapshot_buf);
  snapshot_buf = nullptr;
}

/* ------------------------------------------------------------------------ */
/* Web handlers                                                              */
/* ------------------------------------------------------------------------ */
void handleStatus() {
  String json = "{\"counts\":{";
  for (uint16_t c = 0; c < EI_CLASSIFIER_LABEL_COUNT && c < MAX_CLASSES; c++) {
    if (c > 0) json += ",";
    json += "\"";
    json += ei_classifier_inferencing_categories[c];
    json += "\":";
    json += String(latest_count[c]);
  }
  json += "},\"objects\":" + String(latest_total_objects);
  json += ",\"latency\":" + String(latest_latency_ms);
  json += ",\"w\":" + String(latest_fbw) + ",\"h\":" + String(latest_fbh);
  json += ",\"detections\":[";
  for (int i = 0; i < latest_det_count; i++) {
    if (i > 0) json += ",";
    json += "{\"x1\":" + String(latest_dets[i].x1) +
            ",\"y1\":" + String(latest_dets[i].y1) +
            ",\"x2\":" + String(latest_dets[i].x2) +
            ",\"y2\":" + String(latest_dets[i].y2) +
            ",\"label\":\"" + latest_dets[i].label + "\"" +
            ",\"conf\":" + String(latest_dets[i].conf, 2) + "}";
  }
  json += "]}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

void handleCapture() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    server.send(500, "text/plain", "Capture failed");
    return;
  }
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

void handleIndex() {
  String html = "<!DOCTYPE html><html><head><title>R.A.T.S Detector</title>"
    "<style>body{font-family:sans-serif;background:#1a1a1a;color:#eee;text-align:center;padding:20px}"
    "h1{color:#00E5FF}img{border:2px solid #333;border-radius:8px;max-width:640px}"
    "pre{color:#00E5FF;font-size:18px}</style></head><body>"
    "<h1>R.A.T.S On-Device Detector</h1>"
    "<img id='p' src='/capture' width='480'><pre id='s'>...</pre>"
    "<script>setInterval(()=>{"
    "document.getElementById('p').src='/capture?t='+Date.now();"
    "fetch('/status').then(r=>r.json()).then(d=>{"
    "document.getElementById('s').textContent=JSON.stringify(d.counts)+'  '+d.latency+'ms';"
    "});},2000);</script></body></html>";
  server.send(200, "text/html", html);
}

/* ------------------------------------------------------------------------ */
/* Setup / loop                                                              */
/* ------------------------------------------------------------------------ */
void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n\n=== R.A.T.S On-Device Detector ===");

  if (!psramFound()) {
    Serial.println("ERROR: PSRAM not found! Set Tools > PSRAM > OPI PSRAM");
    while (1) ;
  }

  camera_ready = ei_camera_init();
  if (!camera_ready) {
    Serial.println("ERROR: camera init failed");
    while (1) ;
  }
  Serial.println("Camera ready");
  Serial.printf("Model input: %dx%d  classes: %d\n",
                EI_CLASSIFIER_INPUT_WIDTH, EI_CLASSIFIER_INPUT_HEIGHT,
                EI_CLASSIFIER_LABEL_COUNT);

#if ENABLE_WIFI
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) {  // ~20s timeout
    delay(500);
    Serial.print(".");
    tries++;
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected! Open: http://");
    Serial.println(WiFi.localIP());
    server.on("/", handleIndex);
    server.on("/status", handleStatus);
    server.on("/capture", handleCapture);
    server.begin();
  } else {
    Serial.println("WiFi failed — running inference only");
  }
#else
  Serial.println("WiFi disabled (ENABLE_WIFI 0) — inference only");
#endif
}

void loop() {
#if ENABLE_WIFI
  if (WiFi.status() == WL_CONNECTED) server.handleClient();
#endif
  if (millis() - last_infer_ms >= INFER_INTERVAL_MS) {
    last_infer_ms = millis();
    run_inference();
  }
}
