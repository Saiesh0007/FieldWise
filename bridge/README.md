# FieldWise Pi Bridge

For exactly this setup: a Pixhawk wired over USB to a Raspberry Pi, no
telemetry radio, and you reach the Pi only by SSHing in from a different
computer. FieldWise's browser app normally talks to a Pixhawk directly
via the [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API),
but that only works when the browser and the serial port are on the
*same* machine — which isn't true here. This bridge runs on the Pi,
opens the Pixhawk's serial port, and relays the raw MAVLink byte stream
over a WebSocket that the browser (on your other computer) connects to
instead.

It is a dumb byte pipe — it doesn't parse MAVLink at all. All the actual
protocol logic (heartbeats, telemetry decoding, the mission upload
handshake) is the same already-tested code FieldWise uses for a direct
USB connection; it just runs over this transport instead. See
`src/lib/vehicle/piRelayVehicle.ts` in the main project for that side.

## 1. One-time setup on the Pi

SSH into the Pi, then:

```bash
# Node.js 18+ is required. Check what you have:
node -v

# If that's missing or too old, install a current Node via NodeSource:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# serialport's native binding needs a compiler toolchain to build:
sudo apt-get install -y build-essential python3

# Get this bridge onto the Pi (clone the repo, or just copy the
# bridge/ folder over — it's a fully standalone Node project):
cd bridge
npm install
```

## 2. Find the Pixhawk's serial device

```bash
ls /dev/serial/by-id/
```

You'll see something like `/dev/serial/by-id/usb-3D_Robotics_PX4_FMU_v2.x-if00`.
Either use that full path, or the shorter `/dev/ttyACM0` (numbering can
shift if you plug in other USB-serial devices, so the `by-id` path is
more reliable across reboots).

## 3. Run it

```bash
node serial-ws-bridge.mjs --serial /dev/ttyACM0 --baud 115200 --port 8765
```

It prints the WebSocket address to use. Find the Pi's own IP address
(needed since your browser is on a different machine) with:

```bash
hostname -I
```

Then in FieldWise's **Send to Vehicle** step, choose **Pi bridge** and
enter `ws://<that IP>:8765`.

### No hardware yet? Smoke-test the bridge first

```bash
node serial-ws-bridge.mjs --mock --port 8765
```

This skips opening a real serial port and instead emits a fake
HEARTBEAT once a second, so you can confirm the bridge itself, your
network path, and FieldWise's WebSocket connection all work *before*
you have a Pixhawk plugged in. It only proves connectivity — it does
**not** emulate mission upload/download, so "Upload mission" will still
need a real vehicle (or SITL) to test against.

## 4. Keeping it running after you close the SSH session

By default, the bridge dies the moment your SSH session ends. Two ways
to avoid that:

**Quick and simple** — detach it from the terminal:
```bash
nohup node serial-ws-bridge.mjs --serial /dev/ttyACM0 > bridge.log 2>&1 &
```
Check `bridge.log` for its output later; `pkill -f serial-ws-bridge` to stop it.

**More robust** — run it as a systemd service, so it also survives a Pi
reboot and restarts automatically if it crashes:

```bash
sudo tee /etc/systemd/system/fieldwise-bridge.service > /dev/null <<'EOF'
[Unit]
Description=FieldWise Pi Bridge (Pixhawk serial <-> WebSocket)
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/pi/fieldwise/bridge
ExecStart=/usr/bin/node serial-ws-bridge.mjs --serial /dev/ttyACM0 --baud 115200 --port 8765
Restart=on-failure
User=pi

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now fieldwise-bridge
sudo journalctl -u fieldwise-bridge -f   # watch its logs
```

Adjust `WorkingDirectory` and the `--serial` path for your setup.

## Important: this has no authentication

Anyone who can reach the bridge's port on your network can send MAVLink
commands to the real vehicle through it — there is no login, password,
or pairing step. That's an acceptable tradeoff on a trusted home/field
LAN for development and testing, but:

- Don't expose this port to the open internet (no router port-forwarding to it).
- Stop the bridge (`sudo systemctl stop fieldwise-bridge`, or kill the
  process) when you're not actively flying, especially once arm/mode
  commands are wired up in FieldWise.
- The bridge only allows **one** connected client at a time — a second
  connection attempt is rejected — specifically so two people/tabs
  can't send conflicting commands to the same vehicle simultaneously.

## Status

Verified: the bridge's WebSocket relay and `--mock` heartbeat framing
were checked end-to-end against FieldWise's own trusted MAVLink decoder
and browser-verified through the real UI (connects, shows "Connected",
decodes live telemetry). **Not yet verified against a real Pixhawk** —
that needs your actual hardware. See `../VEHICLE_CONNECTION_CHECKLIST.md`.
