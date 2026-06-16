# PIR-Mode.md — PIR + Camera Integration Plan

How the **PIR AM312** motion sensor works together with the **XIAO ESP32-S3 Sense**
camera/detector. Three options: **Mode 1 (wake/trigger)**, **Mode 2 (gate counting)**,
and the **Combined** mode (a future TODO).

Firmware target: `xiao/detector/detector.ino` (on-device FOMO detector).

---

## Hardware

The AM312 is a mini passive-infrared sensor. 3 pins:

| AM312 pin | Connect to XIAO | Note |
|-----------|-----------------|------|
| VCC | `3V3` | AM312 runs 2.7–12V; 3.3V is fine |
| GND | `GND` | common ground |
| OUT | a **free GPIO** | digital HIGH on motion |

**Free GPIOs on the XIAO S3 Sense** (camera uses most pins): `D0–D3` = GPIO1, GPIO2,
GPIO3, GPIO4. Pick one for `OUT`. (Plan: `D1 / GPIO2`, change if used elsewhere.)

Signal behaviour:
- OUT goes **HIGH (~3.3V)** when motion detected, stays high a short hold (~2 s on AM312),
  then drops LOW.
- Logic is **3.3V** → safe straight into the XIAO, no level shifter.
- AM312 is **fixed** — no sensitivity/time-delay pots (unlike the bigger HC-SR501).

Read it simply:
```cpp
#define PIR_PIN 2            // D1 / GPIO2
pinMode(PIR_PIN, INPUT);
bool motion = digitalRead(PIR_PIN);   // true = motion now
```

---

## Mode 1 — Wake / Trigger (power-save)

Run the camera + inference **only when someone is near**; idle otherwise.

### Flow
```
        no motion
   ┌───────────────────┐
   ▼                   │
[ IDLE ] ──PIR HIGH──► [ ACTIVE: capture + run inference ]
 skip inference          (keep running while motion / hold window)
```

1. **PIR LOW (idle):** skip inference → save compute / heat / power.
2. **PIR HIGH (motion):** wake → capture frames + run FOMO + update counts.
3. After motion stops (+ optional hold window) → back to idle.

### Two power-save flavours — IMPORTANT trade-off
| Flavour | What sleeps | Dashboard while idle | Battery saving |
|---------|-------------|----------------------|----------------|
| **Light idle** (recommended) | only inference is skipped; camera + WiFi stay up | **still reachable** (status/preview live) | modest (less CPU/heat) |
| **Deep sleep** | CPU off, wake on PIR via RTC pin | **NOT reachable** (WiFi off while asleep) | large (true battery) |

> You **cannot** have deep sleep AND an always-on dashboard — WiFi is dead during
> deep sleep, and the device needs ~2–3 s to re-init camera + WiFi on each wake.
> For the current dashboard setup, use **light idle**.

### Pros / Cons
- ➕ Saves power/heat, fewer pointless inferences on an empty room.
- ➖ No counts while idle (counts only refresh when motion happens).

---

## Mode 2 — Gate Counting (accuracy) ⭐ recommended for the shelf

Count **only a clean, undisturbed shelf**. While a hand/person is in frame the image is
blurred/occluded → bad counts. So pause counting during motion, count after it settles.

### Flow
```
[ COUNT (clean shelf) ]
        ▲   │ PIR HIGH (hand in frame)
        │   ▼
   settle  [ DISTURBED: pause counting ]
   3 s ▲       │ PIR LOW
        │      ▼
        └── [ SETTLE: wait 3 s for scene to stabilise ]
```

1. **PIR HIGH:** hand/person in frame → **pause counting** (don't trust blurred frames).
2. **PIR LOW:** start a **settle timer** (~3 s) so the scene stabilises.
3. **Settle done:** run inference → the new count = the true stock after the change.

### Sketch
```cpp
#define PIR_PIN   2
#define SETTLE_MS 3000
uint32_t lastMotion = 0;

// loop:
if (digitalRead(PIR_PIN)) lastMotion = millis();      // motion seen now
bool disturbed = (millis() - lastMotion) < SETTLE_MS; // within settle window
if (!disturbed && time_for_inference) run_inference();// count only clean shelf
```

### Pros / Cons
- ➕ Much steadier, more trustworthy counts; ignores restocking disturbance.
- ➕ Naturally avoids counting a hand as a product.
- ➖ Counts "freeze" while someone is at the shelf (by design).

---

## Combined Mode (FUTURE TODO)

Wake-on-motion (Mode 1) **plus** count-only-clean (Mode 2). Best of both.

### State machine
```
[ IDLE ] ──PIR HIGH──► [ DISTURBED ] ──PIR LOW──► [ SETTLE 3s ] ──clear──► [ COUNT ]
   ▲   skip inference     pause count                 wait               run inference,
   │                                                                     lock new stock
   └──────────────── no motion for a long time ─────────────────────────────┘
```

1. **PIR HIGH** → wake, person/hand in frame → **pause counting** (disturbed).
2. **PIR LOW** → **settle** 3 s.
3. **Settle done** → run inference a few times → **lock the new stock count**.
4. **No motion for a long time** → **IDLE**: stop inferring → save power/heat.

Result: device sleeps-ish when nobody's there, never counts a disturbed frame, and
refreshes stock right after each shelf interaction.

### Extra idea
Publish PIR state in `/status` JSON (e.g. `"motion":true`, `"state":"counting"`) so the
dashboard can show **"Person present — counting paused"** vs **"Idle"** vs **"Live"**.

---

## Things to know / gotchas

- **AM312 warm-up:** needs ~10–60 s after power-on to stabilise; ignore triggers for the
  first ~30 s in firmware to avoid false wakes at boot.
- **Retrigger / hold:** OUT stays HIGH while motion continues and for a short hold after.
  Treat any HIGH as "recent motion" and use a software timer (`lastMotion`) — don't expect
  a clean single pulse.
- **False triggers:** heat sources, moving sunlight/shadows, HVAC airflow, reflective
  surfaces. Mount away from vents/windows. Pairs well with Mode 2 (settle filters brief
  noise).
- **Pin conflict:** the XIAO S3 Sense camera occupies GPIO10–18 and 38–48. Only D0–D3
  (GPIO1–4) are safely free. Confirm the chosen pin isn't used before wiring.
- **3.3V only** — never feed 5V into a XIAO GPIO.
- **Deep sleep vs dashboard:** deep sleep kills WiFi → dashboard goes dark while asleep.
  Decide: always-on dashboard (light idle) **or** battery deep-sleep (offline between
  motions). Not both.
- **Where it hooks in `detector.ino`:** add `pinMode(PIR_PIN, INPUT)` in `setup()`; gate
  the `run_inference()` call in `loop()` on PIR state (Mode 2/Combined) or wrap the whole
  capture+inference (Mode 1).

---

## Open decisions (fill before building)

1. **GPIO for PIR OUT:** ______ (plan: D1 / GPIO2)
2. **Which mode first:** Mode 1 ▢ Mode 2 ▢ Combined ▢
3. **Power-save flavour (if Mode 1/Combined):** light idle ▢ deep sleep ▢

---

*Status: planning note. Combined mode = future TODO. Single mode to be implemented first.*
