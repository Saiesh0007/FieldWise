# Pixhawk connection checklist

This is the one part of the vehicle-link work that genuinely could not be
verified without you and the real hardware. Everything in
`src/lib/vehicle/` up to the serial port itself (MAVLink encoding/decoding,
the mission upload/download handshake) is unit-tested against known byte
sequences and a simulated vehicle — see `mavlinkSession.test.ts` and
`codec.test.ts`. What's untested is the actual `navigator.serial` calls
talking to a real Pixhawk. This checklist is how we close that gap.

**Safety first:** no propellers attached, no battery connected. USB power
from your laptop only. Never click any arm/flight action — this pass only
uploads a mission and reads telemetry, it never arms or flies anything.

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
