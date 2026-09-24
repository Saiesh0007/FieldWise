# Pixhawk connection checklist

This is the one part of the vehicle-link work that genuinely could not be
verified without you and the real hardware. Everything in
`src/lib/vehicle/` up to the serial port itself (MAVLink encoding/decoding,
the mission upload/download handshake) is unit-tested against known byte
sequences and a simulated vehicle — see `mavlinkSession.test.ts` and
`codec.test.ts`. What's untested is the actual `navigator.serial` calls
talking to a real Pixhawk. This checklist is how we close that gap.

**Safety first:** no propellers attached, no battery connected. USB power
from your laptop only. This pass is upload-mission-and-read-telemetry
only — do not touch Arm, Brake, Resume, or Land while following this
section. Those now exist in the app (Send to Vehicle → Flight controls)
but need their own separate, much more careful pass — see "Testing
Arm/Brake/Resume/Land" near the end of this file, which must not be
attempted until everything in this section already passes cleanly.

## What you need

- Pixhawk 2.4.8, connected to your laptop via USB (the same micro-USB port
  you'd use with Mission Planner/QGroundControl).
- **Chrome or Edge** — Web Serial is not implemented in Firefox or Safari.
  The app will show "Web Serial isn't available in this browser" on the
  Send to Vehicle panel if you're in an unsupported one.
- **Close any other program that might be holding the serial port** —
  Mission Planner, QGroundControl, the Arduino IDE's serial monitor, or a
  previous browser tab already connected. Only one program can own a
  serial port at a time; if something else has it open, the browser's
  device picker may not even list it, or the connection will fail
  silently.
- If this is the first time this Pixhawk (or a clone of it) has been
  plugged into this laptop, Windows may need a moment to install a driver
  (commonly CP2102 or FTDI, depending on the board). Check Device Manager
  for a new COM port appearing under "Ports (COM & LPT)" after plugging
  in — if it shows up with a warning icon instead, the driver didn't
  install and needs to be installed manually before any of this will
  work.

## Step by step

1. **Plug the Pixhawk into your laptop via USB.** Wait a few seconds —
   you should hear the board's boot tone (if a buzzer is attached) and
   see its LEDs start blinking.
2. **Run the app** (`npm run dev`) and open it in Chrome or Edge.
3. Go to **Send to Vehicle** (step 5 in the stepper) — this requires a
   plan to exist first, so load the sample field and get through
   Import → Verify → Plan if you haven't already.
4. Click **Connect Pixhawk**. Chrome/Edge will show its own native
   device-picker dialog listing available serial ports.
5. **Select the Pixhawk's port** in that dialog. If you're not sure which
   one it is, check Device Manager first (Windows) for the COM port
   number that appeared when you plugged it in, or unplug/replug the
   board and see which entry appears/disappears in the picker.
6. The status badge should go **"Connecting…"** then, within about 6
   seconds, **"Connected"**.
   - **If it stays on "Connecting…" and then shows "Connection failed"**:
     the app never saw a HEARTBEAT message in time. Most likely causes,
     roughly in order of likelihood: another program still has the port
     open (see above), the wrong port was selected, or the board hasn't
     finished booting yet — retry after waiting a few more seconds.
7. Once connected, the **Live telemetry** card should appear showing:
   - **GPS fix**: likely `no-gps` or `no-fix` indoors — this is normal
     and expected without sky visibility, not a bug. Take the board (or
     just the GPS module, if separable) near a window or outside and
     watch it progress through `2d` → `3d` over the next 30–60 seconds.
     Once it says `3d`, the satellite count and HDOP should both be
     populated (HDOP under about 2.0 is a good fix; a real lat/lon should
     appear matching roughly where you're standing).
   - **Roll / Pitch**, plus the little artificial-horizon dial: **tilt
     the board by hand** and confirm these numbers — and the dial —
     respond immediately. This is the "tilt it and watch it move" proof
     that it's live data, not simulated.
   - The log panel at the bottom of the page shows raw connection events
     — check there first if anything looks stuck or wrong.
8. **Mission upload test**: click **Upload mission**. This sends the
   current plan's waypoints to the Pixhawk, then immediately reads them
   back and compares. Expect one of:
   - **"Verified — N/N waypoints read back match."** — the whole
     round-trip worked.
   - **A mismatch or timeout message** — note exactly what it says (which
     step failed, what the error text was) and the log panel's last few
     lines; that's the fastest way to diagnose it together afterward.
   - A large plan (the sample field is ~68 legs) will take a little while
     to upload one waypoint at a time — that's expected mission-protocol
     behavior, not a hang, as long as the log/progress is still moving.

## If something doesn't work

The three most likely failure points, in order of probability:

1. **No heartbeat ever arrives** (stuck on "Connecting…") — almost always
   a port/driver/other-program-has-it-open issue, not a code issue. Try
   Mission Planner or QGroundControl against the same port first — if
   *those* can't connect either, it's a hardware/driver problem, not
   this app.
2. **Connects, but the mission upload times out** — this would point at
   something in the mission-protocol handshake behaving differently than
   the simulated vehicle in `mavlinkSession.test.ts` assumed (for
   example, older firmware using the legacy `MISSION_REQUEST` message in
   a way the code doesn't expect, or a different sysid/compid than
   assumed). Send me the log panel's contents.
3. **Garbled/wrong-looking telemetry numbers** — would point at a field
   offset or scaling error in `messages.ts` that the byte-level tests
   couldn't catch (they test the codec against itself, not against real
   firmware output). The GPS HDOP scaling (`eph / 100`) and the fix-type
   number mapping are the two values in that file I'm least certain of —
   see the comments in `webSerialVehicle.ts` for exactly which pieces
   came from verified data versus general protocol knowledge.
4. **Only HEARTBEAT arrives — no Attitude, GPS, Battery, Altitude, or
   Wind at all, even though Attitude needs nothing but the IMU** — this
   isn't a FieldWise bug, it's ArduPilot's own telemetry stream rates for
   that serial port (`SR2_*` params for TELEM2, `SR1_*` for TELEM1, etc.)
   defaulting to 0 on a board/port that's never talked to a GCS before.
   Connect once with Mission Planner or QGroundControl on the same link
   to confirm data flows there, which also nudges ArduPilot into
   streaming it going forward.
5. **Mission upload/download completes with no error, but one item
   (almost always wire seq 0) comes back with wildly different lat/lon
   than what was sent** — expected, not a bug: ArduPilot reserves mission
   item seq 0 for HOME and substitutes its own home position there
   regardless of what was uploaded. FieldWise now sends a dedicated home
   item at seq 0 and excludes it from verification (see Memory.md
   ADR-021) — first found and fixed against exactly this symptom on real
   hardware, where the substituted value read back as effectively (0, 0)
   since the vehicle had no GPS fix yet.

Either way — screenshot or copy the log panel's contents and the
status badge's state, and we can fix it from there.

## Connecting via a Raspberry Pi (no telemetry radio, SSH-only access)

If the Pixhawk is wired to a Raspberry Pi instead of directly to the
laptop running the browser — the setup this project actually has (a
Pi 4 + Pixhawk 2.4.8, no telemetry module, reached only over SSH) — Web
Serial can't help at all, because it requires the browser and the
serial port to be on the same machine. Use the **Pi bridge** connection
mode instead: see `bridge/README.md` for the full setup (installing
Node + `serialport` on the Pi, finding the right `/dev/ttyACM0`-style
path, running `serial-ws-bridge.mjs`, and keeping it running after you
log out of SSH).

Everything above this section still applies once connected — same
"Connecting…" → "Connected" flow, same telemetry checks, same mission
upload test — the only difference is which radio button you pick and
that you're entering a `ws://<pi-ip>:8765` address instead of using the
browser's serial-port picker dialog. The one extra failure mode to
check first if it won't connect: is `serial-ws-bridge.mjs` actually
still running on the Pi (SSH back in and check), and can this browser's
machine actually reach the Pi's IP and port (same WiFi/LAN, no
firewall blocking it)?

## Testing Arm/Brake/Resume/Land

**Do not start this section until the mission upload test above already
passes cleanly.** These four buttons (Send to Vehicle → Flight
controls) send real MAVLink commands — `MAV_CMD_COMPONENT_ARM_DISARM`
and `SET_MODE` (Alt Hold / Auto / Land) — that a real flight controller
will act on. Unlike the mission-upload pass above, this one is not safe
to run with propellers attached at any point until every step below has
been verified propeller-off, more than once, without a surprise.

**What's been verified so far:** the MAVLink encoding/decoding for
these commands (`COMMAND_LONG`, `COMMAND_ACK`, `SET_MODE` — byte
offsets, field types, `CRC_EXTRA`) was cross-checked against the
official `mavlink-mappings` package, the same generated-from-XML source
QGroundControl/Mission Planner/pymavlink use — not recalled from
memory. The session logic (`armDisarm`, `setFlightMode` in
`mavlinkSession.ts`) is unit-tested against a simulated vehicle in
`mavlinkSession.test.ts`, and the UI was driven through a real browser
against a fake vehicle that answers exactly like ArduCopter does: slide
to arm → ARMED, Brake → Alt Hold, Resume → Auto, Land → Land, Disarm →
Disarmed. **None of that touched a real flight controller.** ArduPilot's
actual pre-arm safety checks, its actual response timing, and whatever
it does when a mode change is refused, are all real firmware behavior
this can't reach without you and real hardware.

### Step 1 — Propellers OFF, battery connected, bench test

1. Remove every propeller. Confirm by looking, not by memory.
2. Connect the battery (or USB power, whichever your board needs for
   the arming checks to run).
3. Connect in FieldWise as usual, confirm telemetry is live.
4. **Slide to arm.** Expect the badge to flip to **ARMED** within a
   couple of seconds, and you should hear the motors' arming tones (no
   propellers, so nothing spins — just confirms the command landed).
   - **If the vehicle refuses to arm:** the app will show an error
     naming a MAV_RESULT code but not the human-readable reason — this
     codec doesn't decode ArduPilot's STATUSTEXT messages yet. Check
     another GCS (Mission Planner, QGroundControl) or the flight
     controller's own logs for *why* (no GPS lock, bad compass
     calibration, etc.) — that's expected troubleshooting, not
     necessarily a bug in this app.
5. **Disarm.** Confirm the badge returns to Disarmed.
6. Re-arm, then click **Brake**. Expect the flight-mode badge to show
   **Alt Hold** within a few seconds.
7. Click **Resume**. Expect the badge to show **Auto**.
   - If nothing loaded/mission is empty, ArduCopter may refuse to enter
     Auto — that's correct, expected firmware behavior, not a FieldWise
     bug. Upload a mission first (the section above) if you want to see
     Auto actually engage.
8. Click **Land**, confirm the dialog, expect the badge to show **Land**.
9. Disarm again to end the bench test.

### Step 2 — only after Step 1 is clean, repeat with propellers on

Do this outdoors, on the ground, with the vehicle secured or someone
physically ready to intervene, exactly like any other first-arm test
with any GCS. Arm, immediately disarm (motors should not spin up at
idle throttle while merely armed) — if anything unexpected happens,
disarm immediately and stop; don't continue to Brake/Resume/Land until
that's understood.

### Step 3 — in flight (only once Steps 1 and 2 are fully trusted)

This is standard "does my GCS's Loiter/Pause/RTL button work" testing —
treat it exactly that cautiously, at a safe altitude, with a spotter,
and a way to take back manual control (a real RC transmitter) at any
moment. FieldWise is not a substitute for that.
