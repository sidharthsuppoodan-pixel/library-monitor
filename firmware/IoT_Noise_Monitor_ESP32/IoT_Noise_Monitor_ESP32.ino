/* ESP32 Dev Module + KY-038. Relative analog peak-to-peak score, NOT dB.
   Local indicators keep running when Wi-Fi / HTTPS fails.
   API contract: POST /readings, X-API-Key, score/noisy/event_id.
*/
#include <WiFi.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <esp_system.h>
#include <esp_random.h>
#include <time.h>
#include "config.h"

constexpr int SOUND_PIN = 34;
constexpr int GREEN_LED = 18;
constexpr int RED_LED = 19;
constexpr int BUZZER_PIN = 23;
constexpr int SAMPLE_COUNT = 400;
constexpr int QUEUE_LENGTH = 30;
constexpr uint32_t MAX_EVENT_AGE_MS = 120000;
static_assert(NOISE_THRESHOLD >= 0 && NOISE_THRESHOLD <= 4095, "Threshold must be 0..4095");
static_assert(HYSTERESIS >= 0 && HYSTERESIS <= NOISE_THRESHOLD, "Invalid hysteresis");
static_assert(SAMPLE_INTERVAL_MS >= 1000, "Sample interval must be >=1 second");
struct Reading { int score; bool noisy; char eventId[37]; uint32_t sampledAt; };
QueueHandle_t readings;
bool noiseState = false;
uint32_t lastSample = 0;

void makeEventId(char *out) {
  uint8_t bytes[16];
  esp_fill_random(bytes, sizeof(bytes));
  bytes[6] = (bytes[6] & 0x0F) | 0x40;
  bytes[8] = (bytes[8] & 0x3F) | 0x80;
  snprintf(out, 37, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],
           bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);
}

void uploadTask(void *) {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  uint32_t lastReconnect = millis();
  uint32_t backoffMs = 2000;
  const String url(API_URL);
  if (!url.startsWith("https://")) {
    Serial.println("Upload disabled: API_URL must use HTTPS. Local monitoring continues.");
    vTaskDelete(nullptr);
    return;
  }
  for (;;) {
    Reading reading;
    if (xQueueReceive(readings, &reading, portMAX_DELAY) != pdTRUE) continue;
    while (millis() - reading.sampledAt < MAX_EVENT_AGE_MS) {
      if (WiFi.status() != WL_CONNECTED) {
        if (millis() - lastReconnect >= 15000) {
          WiFi.reconnect(); lastReconnect = millis();
          Serial.println("Wi-Fi reconnecting; local monitoring active.");
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
        continue;
      }
      // Accurate time is needed to check the server certificate's validity.
      if (time(nullptr) < 1700000000) {
        Serial.println("Waiting for network time before TLS verification.");
        vTaskDelay(pdMS_TO_TICKS(2000));
        continue;
      }
      NetworkClientSecure client;
      client.setCACert(ROOT_CA);
      client.setHandshakeTimeout(8);
      HTTPClient http;
      http.setConnectTimeout(5000);
      http.setTimeout(5000);
      int status = -1;
      if (http.begin(client, API_URL)) {
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-API-Key", DEVICE_API_KEY);
        char body[160];
        snprintf(body, sizeof(body), "{\"score\":%d,\"noisy\":%s,\"event_id\":\"%s\"}",
                 reading.score, reading.noisy ? "true" : "false", reading.eventId);
        status = http.POST(reinterpret_cast<uint8_t *>(body), strlen(body));
      }
      http.end();
      Serial.printf("Upload HTTP status: %d\n", status); // Never log credentials.
      if (status == 200 || status == 201) { backoffMs = 2000; break; }
      // Schema/key errors need operator action. Avoid hammering the server.
      if (status >= 400 && status < 500 && status != 408 && status != 429) {
        Serial.println("Upload rejected. Check API key, URL and payload configuration.");
        vTaskDelay(pdMS_TO_TICKS(30000));
        break;
      }
      uint32_t delayMs = status == 429 ? 60000 : backoffMs + (esp_random() % 500);
      vTaskDelay(pdMS_TO_TICKS(delayMs));
      backoffMs = backoffMs < 30000 ? backoffMs * 2 : 60000;
      // Retrying uses the same event_id; the server will not store duplicates.
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(GREEN_LED, OUTPUT); pinMode(RED_LED, OUTPUT); pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(GREEN_LED, LOW); digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_HIGH ? LOW : HIGH);
  analogReadResolution(12);
  analogSetPinAttenuation(SOUND_PIN, ADC_11db);
  readings = xQueueCreate(QUEUE_LENGTH, sizeof(Reading));
  if (readings == nullptr) {
    Serial.println("Queue allocation failed; local monitoring remains active.");
  } else if (xTaskCreate(uploadTask, "noise-upload", 12288, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("Upload task allocation failed; local monitoring remains active.");
  }
  lastSample = millis() - SAMPLE_INTERVAL_MS;
  Serial.println("Noise monitor ready. Scores are relative analog values, not decibels.");
}

void loop() {
  if (millis() - lastSample < SAMPLE_INTERVAL_MS) { delay(5); return; }
  lastSample = millis();
  int minimum = 4095, maximum = 0;
  for (int i = 0; i < SAMPLE_COUNT; i++) {
    int value = analogRead(SOUND_PIN);
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
    delayMicroseconds(100);
  }
  Reading reading{};
  reading.score = maximum - minimum;
  if (reading.score >= NOISE_THRESHOLD) noiseState = true;
  else if (reading.score < NOISE_THRESHOLD - HYSTERESIS) noiseState = false;
  reading.noisy = noiseState;
  reading.sampledAt = millis();
  makeEventId(reading.eventId);
  digitalWrite(GREEN_LED, noiseState ? LOW : HIGH);
  digitalWrite(RED_LED, noiseState ? HIGH : LOW);
  if (noiseState) {
    digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_HIGH ? HIGH : LOW); // Beep when noisy (Red LED)
  } else {
    digitalWrite(BUZZER_PIN, BUZZER_ACTIVE_HIGH ? LOW : HIGH); // Silent when quiet (Green LED)
  }
  Serial.printf("score=%d noisy=%s\n", reading.score, noiseState ? "true" : "false");
  if (readings && xQueueSend(readings, &reading, 0) != pdTRUE) {
    Reading discarded;
    xQueueReceive(readings, &discarded, 0); // Prefer fresh data when the RAM queue fills.
    xQueueSend(readings, &reading, 0);
    Serial.println("Offline queue full; oldest queued reading discarded.");
  }
}
