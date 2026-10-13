# Autonomous Helium Balloon with 4-BLDC Motor Propulsion Simulator 🎈⚡🛰️
### Engineering-Grade Autonomous High-Altitude Research Balloon Simulation in Godot 4.7

An interactive, physics-based 3D simulation in **Godot 4.7** of an autonomous helium research balloon carrying a suspended electronics payload and utilizing **four independently commanded brushless DC (BLDC) motors** mounted on a lower structural frame for active trajectory correction and multi-waypoint navigation through changing atmospheric wind fields.

---

## 1. System Overview & Physical Assembly

The simulation reconstructs the balloon and payload system based on engineering specifications and physical reference sketches:

```
                  ┌──────────────────────┐
                  │   Prolate Helium     │
                  │   Balloon Envelope   │
                  │ (V = 41.89 m³, r=2m) │
                  └──────────┬───────────┘
                             │ Collar Ring
                 /───────────┼───────────\
                /      4 Suspension       \
               /          Cables           \
              /                             \
    ┌────────▼───────────────────────────────▼────────┐
    │          Lower Carbon-Fiber Motor Frame         │
    │  [M4: Front-Left]             [M1: Front-Right] │
    │         \       ┌───────────┐       /           │
    │          \──────┤ Avionics  ├──────/            │
    │          /──────┤  Payload  ├──────\            │
    │         /       └───────────┘       \           │
    │  [M3: Rear-Left]               [M2: Rear-Right] │
    └─────────────────────────────────────────────────┘
```

### A. Helium Balloon Envelope
- **Prolate Spheroid Geometry**: Nominal radius $r = 2.0\text{ m}$, vertical elongation factor $1.25\times$, gas volume $V = 41.89\text{ m}^3$, dry skin mass $8.5\text{ kg}$.
- **Translucent PBR Material**: Realistic high-altitude polyethylene/latex shader with subtle Fresnel sheen, internal scattering, 16 meridian gore seams, equator band, apex valve, and bottom load ring collar ($y = -2.65\text{ m}$).

### B. Suspension Rigging
- **Four High-Tensile Cables**: Vectran/steel cords symmetrically connecting the envelope load ring to the four structural frame arms.
- **Dynamic Real-Time Geometry**: Rendered using `ImmediateMesh` line primitives that track dynamic payload and motor frame pendulum swaying.

### C. Electronics Payload Bay
Suspended centrally on the lower frame ($0.08\text{ m}$ elevation above hub plate):
- **Flight Controller PCB**: Dark-green solder mask with gold ENIG contacts, mounting holes, trace runs, bus connectors, and status LEDs.
- **Edge-AI Compute Module**: Dual-heatsink graphite TPU / Jetson Orin Nano neural accelerator.
- **GNSS/GPS Receiver**: Ceramic patch antenna and RF shielding can.
- **9-DOF IMU**: Accelerometer, rate gyroscope, and magnetometer package.
- **Barometric & Temperature Sensor**: Ambient pressure transducer and precision thermistor.
- **Telemetry & Communications**: 915 MHz LoRa radio transceiver and whip antenna.
- **4× Electronic Speed Controllers (ESCs)**: Dedicated motor drives with thermal heat sinks.
- **LiFePO4 Flight Battery Pack**: 4S battery module with terminal wiring.

### D. Four BLDC Motor & Propeller Assemblies
Four independently modeled BLDC motor pods mounted on the lower cross-arms at radius $R = 0.85\text{ m}$:
- **Procedural 3D Mesh**: CNC aluminum L-mount bracket, black anodized stator & rotor can, visible copper windings, stainless steel shaft, aerodynamic propeller hub, and high-aspect 3-blade propeller ($r_{\text{prop}} = 0.152\text{ m}$).
- **Visual Propeller Rotation**: Rotates continuously based on live physical RPM with smooth angular interpolation.
- **Configurable Coordinate Layout**:
  - **M1 (Front-Right)**: Mount position `(+0.60, 0.0, -0.60)`, thrust vector `(+0.7071, 0.0, -0.7071)`, CW spin.
  - **M2 (Rear-Right)**: Mount position `(+0.60, 0.0, +0.60)`, thrust vector `(+0.7071, 0.0, +0.7071)`, CCW spin.
  - **M3 (Rear-Left)**: Mount position `(-0.60, 0.0, +0.60)`, thrust vector `(-0.7071, 0.0, +0.7071)`, CW spin.
  - **M4 (Front-Left)**: Mount position `(-0.60, 0.0, -0.60)`, thrust vector `(-0.7071, 0.0, -0.7071)`, CCW spin.

---

## 2. Propulsion Physics & Mathematical Control Allocation

### Motor Actuator Dynamics
Each motor assembly is governed by continuous first-order lag and quadratic propeller aerodynamics:
- **Spin-Up / Spin-Down Lag**:
  $$\frac{d\omega_i}{dt} = \frac{\omega_{\text{cmd}, i} - \omega_i}{\tau_{\text{motor}}}$$
  where $\tau_{\text{motor}} = 0.12\text{ s}$ and $\omega_{\text{max}} = 7,200\text{ RPM}$.
- **Quadratic Thrust**:
  $$T_i = \text{sgn}(\omega_i) \cdot k_T \cdot \omega_i^2$$
  where $k_T = 1.1 \times 10^{-6}\text{ N/RPM}^2$. At maximum speed ($7,200\text{ RPM}$), each motor delivers $\approx 56.4\text{ N}$ of thrust.
- **Propeller Reaction Torque**:
  $$Q_i = -s_i \cdot k_Q \cdot \omega_i^2$$
  where $s_i \in \{+1, -1\}$ is the spin direction and $k_Q = 2.2 \times 10^{-8}\text{ N}\cdot\text{m/RPM}^2$.
- **Electrical Power & ESC Thermal Model**:
  $$P_i = P_{\text{idle}} + c_{\text{pow}} \cdot |\omega_i|^3$$
  $$\frac{dT_{\text{ESC}, i}}{dt} = \alpha P_i - \beta (T_{\text{ESC}, i} - T_{\text{ambient}})$$
  with idle power $2.5\text{ W}$, $c_{\text{pow}} = 2.2 \times 10^{-10}\text{ W/RPM}^3$, and automatic thermal clamping.

### Control Effectiveness Matrix $B$
The 4-motor layout generates horizontal forces $\vec{F} = [F_x, F_z]^T$ and yaw moment $\tau_y$ according to the linear effectiveness mapping:
$$\begin{bmatrix} F_x \\ F_z \\ \tau_y \end{bmatrix} = \mathbf{B} \begin{bmatrix} u_1 \\ u_2 \\ u_3 \\ u_4 \end{bmatrix}$$
where $u_i \in [-1.0, 1.0]$ is the normalized motor throttle. Column $i$ of matrix $\mathbf{B}$ is:
$$\mathbf{b}_i = T_{\text{max}} \begin{bmatrix} t_{x, i} \\ t_{z, i} \\ (\vec{r}_i \times \vec{t}_i)_y \end{bmatrix} = T_{\text{max}} \begin{bmatrix} t_{x, i} \\ t_{z, i} \\ r_{z, i} t_{x, i} - r_{x, i} t_{z, i} \end{bmatrix}$$

### Moore-Penrose Pseudoinverse & Tikhonov Regularization
To solve for motor commands $\vec{u}$ given desired virtual control vector $\vec{v}_{\text{des}} = [F_{x,\text{des}}, F_{z,\text{des}}, \tau_{y,\text{des}}]^T$, the allocator computes the minimum-norm pseudoinverse:
$$\mathbf{B}^\dagger = \mathbf{B}^T \left(\mathbf{B} \mathbf{B}^T + \lambda \mathbf{I}_3\right)^{-1}$$
where $\lambda = 10^{-4}$ provides Tikhonov regularization, preventing singular matrix inversions even under multiple actuator failures.

### Actuator Saturation & Fault Adaptation
1. **Saturation Enforcement**: Actuator throttles are strictly clamped:
   $$u_i = \text{clamp}(u_i, -1.0, 1.0)$$
2. **Infeasibility Flagging**: The allocator computes residual error $\epsilon = \|\vec{v}_{\text{des}} - \mathbf{B} \vec{u}_{\text{clamped}}\|$ and flags infeasibility when saturation exceeds available authority.
3. **Cutoff Fault Handling**: If motor $k$ suffers a hardware failure, column $\mathbf{b}_k$ is zeroed out, and $\mathbf{B}^\dagger$ is dynamically recomputed to distribute control across the remaining operational motors.

---

## 3. Three-Layer Edge-AI Navigation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ LAYER A: SENSOR FUSION & STATE ESTIMATION (10 Hz)           │
│ - GNSS, Barometer, 9-DOF IMU, Thermistor, Wind Estimator    │
│ - GNSS Dropout Detection -> IMU / Baro Dead-Reckoning       │
└──────────────────────────────┬──────────────────────────────┘
                               │ State Estimate x_hat
┌──────────────────────────────▼──────────────────────────────┐
│ LAYER B: AUTONOMOUS NAVIGATION PLANNER (5 Hz)               │
│ - Multi-Waypoint Sequencer (WP1 -> WP2 -> WP3)              │
│ - Feed-forward Aerodynamic Wind Drift Cancellation          │
│ - Cross-Track / Proportional Velocity Guidance              │
│ - Control Authority & Loiter Logic                          │
└──────────────────────────────┬──────────────────────────────┘
                               │ Desired [Fx, Fz, Tau_y]
┌──────────────────────────────▼──────────────────────────────┐
│ LAYER C: MOTOR CONTROL ALLOCATION (60 Hz)                   │
│ - Moore-Penrose Pseudoinverse B^+                           │
│ - Actuator Clamping [-1.0, 1.0]                             │
│ - Motor Saturation & Health Fault Isolation                 │
└──────────────────────────────┬──────────────────────────────┘
                               │ Throttle Commands [u1, u2, u3, u4]
┌──────────────────────────────▼──────────────────────────────┐
│ FOUR BLDC MOTORS & FLIGHT DYNAMICS (60 Hz)                  │
│ - Thrust, Reaction Torque, Power Draw, ESC Temperature      │
└─────────────────────────────────────────────────────────────┘
```

- **Layer A (State Estimator)**: Fuses noisy GNSS ($\sigma_h = 1.5\text{m}$), barometric pressure ($\sigma = 4\text{Pa}$), and IMU acceleration/rates. If GNSS drops out, it seamlessly transitions to inertial dead-reckoning.
- **Layer B (Navigation Planner)**: Sequences sequential waypoints (`WP1: (350, 320, -250)`, `WP2: (700, 350, -600)`, `WP3: (200, 380, -900)`). Computes feed-forward drag counter-thrust:
  $$\vec{F}_{\text{feedforward}} = \frac{1}{2} \rho_{\text{air}} C_d A \|\vec{v}_{\text{wind}}\| \vec{v}_{\text{wind}}$$
  and adds proportional correction toward the active waypoint.
- **Layer C (Motor Allocator)**: Solves the $3 \times 4$ inverse mapping to command the four ESCs.

---

## 4. Atmospheric Flight Physics & Wind Field

### 6-DOF Flight Dynamics
- **Standard ISA Atmosphere**: Temperature lapse rate ($L = 0.0065\text{ K/m}$), barometric pressure $P(z)$, and air density $\rho_{\text{air}}(z)$ evaluated continuously.
- **Net Vertical Buoyancy**:
  $$F_{\text{net}, y} = (\rho_{\text{air}}(z) V - m_{\text{total}}) \cdot g$$
  where total mass includes envelope skin ($8.5\text{ kg}$), motor frame ($3.2\text{ kg}$), avionics payload ($12.5\text{ kg}$), rigging ($1.4\text{ kg}$), ballast ($3.0\text{ kg}$), and helium gas mass.
- **Aerodynamic Drag**:
  $$\vec{v}_{\text{rel}} = \vec{v}_{\text{balloon}} - \vec{v}_{\text{wind}}$$
  $$\vec{F}_{\text{drag}} = -\frac{1}{2} \rho_{\text{air}}(z) \left(C_{d,\text{env}} A_{\text{env}} + C_{d,\text{pay}} A_{\text{pay}}\right) \|\vec{v}_{\text{rel}}\| \vec{v}_{\text{rel}}$$
- **Active 4-Motor Thrust & Yaw Integration**: Motor forces $\vec{F}_{\text{net,world}}$ and differential motor moments $\tau_y$ are directly integrated into the vehicle acceleration and yaw rotational velocity.
- **Payload Pendulum Dynamics**: 3D spherical pendulum oscillation driven by vehicle lateral accelerations with natural frequency $\omega_0 = \sqrt{g/L} \approx 1.6\text{ rad/s}$ and damping ratio $\zeta = 0.55$.

### Atmospheric Wind Scenarios
The `WindField` module provides ten distinct test scenarios:
1. `Calm Ascent`: Negligible wind ($< 0.5\text{ m/s}$) for baseline vertical stability.
2. `Crosswind Drift`: Moderate $6.0\text{ m/s}$ crosswind from $090^\circ$ (East).
3. `Strong Wind Trajectory Correction`: $12.0\text{ m/s}$ wind challenging active motor authority.
4. `Wind Gusts & Turbulence`: Simplex 3D turbulence with discrete $+6.0\text{ m/s}$ gusts.
5. `Wind-Direction Reversal`: Dynamic shear reversing direction by $180^\circ$ at altitude.
6. `Multi-Waypoint Route Navigation`: Changing wind layers while guiding along WP1 $\to$ WP2 $\to$ WP3.
7. `Battery Depletion & Power Limits`: High motor drain causing voltage sag and throttle derating.
8. `One-Motor Failure & Re-allocation`: Hard cutoff of motor M1, testing dynamic re-allocation.
9. `GNSS Dropout & Dead Reckoning`: Loss of satellite fix forcing inertial dead-reckoning.
10. `External AI Disconnect`: Offline Python HTTP microservice triggering onboard fallback.

---

## 5. User Interface & Inspection Modes

### Mission Control Telemetry Ribbon
- **Flight Status**: Mission clock, time scale warp (`1x`, `2x`, `5x`), flight phase, and altitude.
- **Ground Track**: Ground speed ($v_g$), heading, air-relative speed ($v_{\text{rel}}$), climb rate ($v_y$).
- **Navigation Vector**: Active waypoint, range-to-go, cross-track error, active mode.
- **Avionics Health**: Battery voltage, capacity %, total power draw (Watts).

### 4-BLDC Motor Telemetry Cards
Four real-time cards displaying for M1, M2, M3, and M4:
- Commanded vs actual RPM with progress bar.
- Output aerodynamic thrust (Newtons).
- Electrical power consumption (Watts).
- ESC heatsink temperature ($^\circ\text{C}$).
- Health status badge (`HEALTHY` / `FAULT`).

### 2D Top-Down Motor Layout Schematic
An embedded canvas HUD rendering the physical propulsion geometry:
- Central frame and payload center-of-mass indicator.
- M1–M4 pod locations with spin direction rings (CW / CCW).
- Live thrust vector arrows scaling with propeller load.
- Resulting net thrust force arrow and net vehicle torque arc.

### Manual Motor Test Mode
- Toggle switch between `Autonomous Flight` and `Manual Motor Test`.
- Four independent sliders $[-1.0, 1.0]$ to test individual motor spin-up, thrust, and moments.
- Direct failure injection buttons to simulate motor cutoffs.

### Camera Modes
- **Key 1 — Orbit**: 360° orbit around envelope and payload.
- **Key 2 — Chase**: Follow camera locked behind flight heading.
- **Key 3 — Inspect Avionics**: High-zoom inspection of payload PCB and sensors.
- **Key 4 — Tactical Map**: High-altitude top-down situational overview.
- **Key 5 — Top-Down Motor Layout**: Orthographic top-down inspection of motor frame and thrust axes.

---

## 6. External Python AI Inference Microservice

The simulation supports an optional external AI guidance server running in standard Python 3:
- Standalone microservice: `ai_service/server.py` (zero external pip packages).
- Non-blocking `HTTPRequest` polling with automatic timeout ($< 350\text{ ms}$).
- Seamless fallback to internal GDScript controller if the server is offline.

To start the server:
```bash
python3 ai_service/server.py
```
To run the automated API verification client:
```bash
python3 ai_service/test_client.py
```

---

## 7. Automated Engineering Verification Suite

The project includes an automated headless verification suite validating all 15 acceptance criteria:

```bash
/home/venkatengineer/.local/bin/godot --headless --script tests/test_simulation_verification.gd
```

### Verification Results (15/15 Passed):
| # | Acceptance Criterion | Result | Details |
|---|----------------------|:------:|---------|
| 1 | Envelope, suspension, payload, and 4 BLDC motors are distinct 3D objects | **PASS** | Verified full node hierarchy & 4 motor pods |
| 2 | All four propellers rotate independently per commanded throttles | **PASS** | M1: 2800 RPM, M2: 4901 RPM, M3: -3501 RPM, M4: 0 RPM |
| 3 | Motor RPM changes produce quadratic aerodynamic thrust ($T = k_T \omega^2$) | **PASS** | $T_{3600} = 13.94\text{ N}$, $T_{7200} = 56.38\text{ N}$, Ratio: $4.05\times$ |
| 4 | Motor forces applied at mount offsets generate translational & moment forces | **PASS** | $F_{\text{net}} = 52.2\text{ N}$, Torque $= 1.04\text{ N}\cdot\text{m}$ |
| 5 | Atmospheric wind creates realistic aerodynamic drag and horizontal drift | **PASS** | East velocity: $10.0\text{ m/s}$, Displacement: $37.2\text{ m}$ |
| 6 | Motor corrections actively oppose wind and steer trajectory | **PASS** | Resulting $v_x = 3.0\text{ m/s}$ vs $8.0\text{ m/s}$ unmitigated wind |
| 7 | Suspended payload responds to acceleration with natural frequency and damping | **PASS** | Active roll: $0.16\text{ rad}$, Damped roll: $0.01\text{ rad}$ |
| 8 | Edge-AI planner computes corrective horizontal forces from sensor observations | **PASS** | Desired $F_x: 5.6\text{ N}$, $F_z: -11.2\text{ N}$ |
| 9 | Motor allocator enforces throttle limits $[-1.0, 1.0]$ and flags infeasibility | **PASS** | Bounded throttles, infeasibility flagged under overload |
| 10 | Telemetry readouts reflect live physical state | **PASS** | Live RPM, quadratic thrust, and cubic power match physics |
| 11 | One-motor failure (M1 cutoff) isolates faulted actuator and re-allocates | **PASS** | M1 commanded to 0, remaining motors re-allocated |
| 12 | Trajectory predictor recomputes future flight path based on motor thrust | **PASS** | Dynamic path divergence under active motor thrust |
| 13 | Mission lifecycle controls (launch, pause, speed warp, reset) operate correctly | **PASS** | State machine transitions verified |
| 14 | Autonomous navigation operates seamlessly when external AI is offline | **PASS** | Internal fallback maintains continuous control |
| 15 | Full Godot 4.7 orchestrator executes frames with zero runtime errors | **PASS** | Headless loop completed with 0 errors |

---

## 8. Running the Simulation

### In Godot Editor / GUI:
1. Open Godot 4.7.
2. Import the project at `/data/project/manjari/simulation/project.godot`.
3. Press **F5** (or Run Project) to launch the simulation.

### Headless Verification:
```bash
# Run 15-point automated verification test suite:
godot --headless --script tests/test_simulation_verification.gd

# Run 120 frames of full main scene headless execution:
godot --headless --quit-after 120
```
