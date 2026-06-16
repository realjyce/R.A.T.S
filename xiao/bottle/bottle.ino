#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>

// WiFi credentials
const char* ssid = "SK_06D0_2.4G";
const char* password = "AAB2F@2515";

WebServer server(80);

// Camera pins (XIAO ESP32-S3 Sense)
#define PWDN_GPIO_NUM -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 10
#define SIOD_GPIO_NUM 40
#define SIOC_GPIO_NUM 39
#define Y9_GPIO_NUM 48
#define Y8_GPIO_NUM 11
#define Y7_GPIO_NUM 12
#define Y6_GPIO_NUM 14
#define Y5_GPIO_NUM 16
#define Y4_GPIO_NUM 18
#define Y3_GPIO_NUM 17
#define Y2_GPIO_NUM 15
#define VSYNC_GPIO_NUM 38
#define HREF_GPIO_NUM 47
#define PCLK_GPIO_NUM 13

int photoCount = 0;

void initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 10000000;
  config.frame_size = FRAMESIZE_VGA;     // 640x480 for collection
  config.pixel_format = PIXFORMAT_JPEG;  // JPEG for saving
  config.grab_mode = CAMERA_GRAB_LATEST;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.fb_count = 2;
  config.jpeg_quality = 10;  // lower = better quality

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    while (1)
      ;
  }

  sensor_t* s = esp_camera_sensor_get();
  s->set_vflip(s, 1);
  s->set_brightness(s, 1);
  Serial.println("Camera ready");
}

// Serve a single JPEG frame
void handleCapture() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    server.send(500, "text/plain", "Capture failed");
    return;
  }
  photoCount++;
  Serial.printf("Photo #%d captured (%d bytes)\n", photoCount, fb->len);

  server.sendHeader("Content-Disposition",
                    "attachment; filename=shelf_" + String(photoCount) + ".jpg");
  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// Live MJPEG stream
void handleStream() {
  WiFiClient client = server.client();
  String boundary = "frame";
  client.println("HTTP/1.1 200 OK");
  client.println("Content-Type: multipart/x-mixed-replace; boundary=" + boundary);
  client.println();

  while (client.connected()) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) continue;

    client.println("--" + boundary);
    client.println("Content-Type: image/jpeg");
    client.println("Content-Length: " + String(fb->len));
    client.println();
    client.write(fb->buf, fb->len);
    client.println();
    esp_camera_fb_return(fb);
    delay(100);
  }
}

// Auto-capture page with timer
void handleIndex() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
    <title>R.A.T.S Auto-Downloader</title>
    <style>
        body { font-family: sans-serif; background: #1a1a1a; color: #eee; text-align: center; padding: 20px; }
        h1 { color: #00E5FF; }
        img { border: 2px solid #333; border-radius: 8px; max-width: 640px; margin-top: 10px; }
        .btn { background: #2A2A2A; color: #eee; border: 1px solid #555; padding: 12px 24px; margin: 8px; cursor: pointer; border-radius: 6px; }
        .btn-go { border-color: #00E5FF; color: #00E5FF; }
        .btn-stop { border-color: #FF4444; color: #FF4444; }
        #counter { font-size: 48px; color: #00E5FF; }
    </style>
</head>
<body>
    <h1>R.A.T.S Data Collector</h1>
    <div id="counter">0</div>
    <img id="preview" src="/capture" width="640">
    <br><br>
    <label>Interval (sec): <input type="number" id="interval" value="3" min="1" style="width:50px;"></label>
    <label style="margin-left:15px;">Label: <input type="text" id="label" value="item" style="width:80px;"></label>
    <br><br>
    <button class="btn btn-go" onclick="startCapture()">Start Auto-Download</button>
    <button class="btn btn-stop" onclick="stopCapture()">Stop</button>

    <script>
        let timer = null;
        let count = 0;

        function downloadFrame() {
            let label = document.getElementById('label').value;
            let ts = Date.now();
            let url = '/capture?t=' + ts;
            
            // Update preview
            document.getElementById('preview').src = url;
            count++;
            document.getElementById('counter').textContent = count;

            // Trigger Automatic Download
            const link = document.createElement('a');
            link.href = url;
            link.download = `${label}_${count}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        function startCapture() {
            if (timer) return;
            let sec = parseInt(document.getElementById('interval').value) || 3;
            downloadFrame();
            timer = setInterval(downloadFrame, sec * 1000);
        }

        function stopCapture() {
            clearInterval(timer);
            timer = null;
        }
    </script>
</body>
</html>
)rawliteral";
  server.send(200, "text/html", html);
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n\n=== R.A.T.S Data Collector ===");

  if (!psramFound()) {
    Serial.println("ERROR: PSRAM not found!");
    while (1)
      ;
  }

  initCamera();

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected! Open browser: http://");
  Serial.println(WiFi.localIP());

  server.on("/", handleIndex);
  server.on("/capture", handleCapture);
  server.on("/stream", handleStream);
  server.begin();
}

void loop() {
  server.handleClient();
}