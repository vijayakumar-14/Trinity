class_name SimulationConfig
extends Resource

## Engineering-grade physical and mission configuration parameters.
## Supports 4-BLDC-motor active navigation, ISA atmospheric physics, and sensor models.

# ==============================================================================
# 1. BALLOON ENVELOPE SPECIFICATIONS
# ==============================================================================
@export_group("Balloon Envelope")
## Nominal radius of the balloon envelope at sea level (meters).
@export var envelope_radius: float = 2.0
## Vertical aspect ratio scale factor (elongated prolate spheroid).
@export var envelope_vertical_scale: float = 1.25
## Gas volume of envelope (cubic meters): V = (4/3) * PI * r^3 * vertical_scale.
@export var envelope_volume: float = 41.89
## Dry mass of the latex/polyurethane balloon envelope skin (kg).
@export var envelope_mass: float = 8.5
## Aerodynamic drag coefficient for balloon envelope (dimensionless).
@export var envelope_drag_coeff: float = 0.47
## Reference cross-sectional area of envelope (sq meters): A = PI * r^2.
@export var envelope_reference_area: float = 12.57

# ==============================================================================
# 2. GAS PROPERTIES (HELIUM)
# ==============================================================================
@export_group("Helium Gas")
## Helium density at standard sea-level temperature & pressure (kg/m^3).
@export var helium_density_sl: float = 0.169
## Molar mass of helium gas (kg/mol).
@export var molar_mass_helium: float = 0.0040026
## Molar mass of dry atmospheric air (kg/mol).
@export var molar_mass_air: float = 0.0289644
## Universal gas constant (J / (mol * K)).
@export var gas_constant_universal: float = 8.31446

# ==============================================================================
# 3. ELECTRONICS PAYLOAD & RIGGING
# ==============================================================================
@export_group("Payload & Rigging")
## Mass of electronics enclosure, sensors, battery, and AI compute board (kg).
@export var payload_mass: float = 12.5
## Mass of lower carbon-fiber motor frame and arm assemblies (kg).
@export var motor_frame_mass: float = 3.2
## Mass of 4 suspension cables and bridle hardware (kg).
@export var rigging_mass: float = 1.4
## Droppable ballast mass for buoyancy control (kg).
@export var ballast_mass: float = 3.0
## Minimized vertical clearance of suspension from collar to motor frame (meters).
@export var suspension_cable_length: float = 0.35
## Payload frontal cross-sectional area (sq meters).
@export var payload_reference_area: float = 0.22
## Aerodynamic drag coefficient for payload frame (dimensionless).
@export var payload_drag_coeff: float = 1.15
## Angular pendulum damping coefficient (dimensionless / s).
@export var pendulum_damping: float = 1.6

# ==============================================================================
# 4. FOUR-BLDC-MOTOR PROPULSION SYSTEM
# ==============================================================================
@export_group("4-BLDC Motors")
## Radial distance of each motor mount from the central frame axis (meters).
@export var motor_arm_radius: float = 0.85
## Maximum motor rotational speed (RPM).
@export var motor_max_rpm: float = 7200.0
## Minimum motor rotational speed (RPM, negative for reversible ESCs).
@export var motor_min_rpm: float = -7200.0
## Propeller thrust coefficient kT: Thrust = kT * RPM^2 (Newtons / RPM^2).
## At 7200 RPM, generates ~5.7 N thrust per motor (total 22.8 N max).
@export var motor_kt: float = 1.1e-6
## Propeller torque coefficient kQ: Reaction Torque = kQ * RPM^2 (N*m / RPM^2).
@export var motor_kq: float = 2.2e-8
## Motor spin-up / spin-down first order time constant (seconds).
@export var motor_time_constant: float = 0.12
## Propeller radius (meters, ~12-inch propeller).
@export var propeller_radius: float = 0.152
## Idle power per motor controller / ESC (Watts).
@export var motor_idle_power_watts: float = 2.5
## Electrical power coefficient per motor: Power = idle + c_pow * |RPM|^3 (Watts).
@export var motor_power_coeff: float = 2.2e-10

# Motor layout configuration positions in local frame coordinates (X = right, Z = back)
# M1: Front-Right (+X, -Z)
# M2: Rear-Right  (+X, +Z)
# M3: Rear-Left   (-X, +Z)
# M4: Front-Left  (-X, -Z)
@export var motor_positions: Array[Vector3] = [
	Vector3(0.60, 0.0, -0.60),  # M1
	Vector3(0.60, 0.0, 0.60),   # M2
	Vector3(-0.60, 0.0, 0.60),  # M3
	Vector3(-0.60, 0.0, -0.60)  # M4
]

# Nominal thrust direction unit vectors in frame coordinates (canted quad-pusher arrangement)
# Each motor thrusts outward/tangentially, enabling 2D horizontal force and yaw control
@export var motor_thrust_directions: Array[Vector3] = [
	Vector3(0.7071, 0.0, -0.7071),  # M1: Forward-Right
	Vector3(0.7071, 0.0, 0.7071),   # M2: Rear-Right
	Vector3(-0.7071, 0.0, 0.7071),  # M3: Rear-Left
	Vector3(-0.7071, 0.0, -0.7071)  # M4: Forward-Left
]

# Propeller rotation directions: +1 = CW, -1 = CCW
@export var motor_spin_directions: Array[int] = [1, -1, 1, -1]

# ==============================================================================
# 5. ATMOSPHERIC MODEL (ISA Standard Atmosphere)
# ==============================================================================
@export_group("Atmosphere")
## Sea level standard atmospheric pressure (Pa).
@export var sea_level_pressure: float = 101325.0
## Sea level standard temperature (Kelvin: 288.15 K = 15°C).
@export var sea_level_temp_k: float = 288.15
## Sea level standard air density (kg/m^3).
@export var sea_level_air_density: float = 1.225
## Temperature lapse rate in troposphere (K/m).
@export var lapse_rate: float = 0.0065
## Gravitational acceleration (m/s^2).
@export var gravity: float = 9.80665
## Gas constant for dry air (J / (kg * K)).
@export var gas_constant_air: float = 287.058

# ==============================================================================
# 6. ELECTRICAL SYSTEM & BATTERY
# ==============================================================================
@export_group("Electrical System")
## Battery capacity (Watt-hours, 4S4P 21700 Li-ion pack).
@export var battery_capacity_wh: float = 380.0
## Baseline electronics idle power consumption (Watts).
@export var electronics_idle_power_watts: float = 16.0
@export var idle_power_watts: float = 16.0
## Edge AI TPU inference peak power consumption (Watts).
@export var ai_compute_power_watts: float = 22.0
@export var thruster_power_watts: float = 65.0

# ==============================================================================
# 7. MISSION WAYPOINTS & SENSOR NOISE
# ==============================================================================
@export_group("Navigation & Sensors")
## Multi-waypoint mission route in 3D world space (meters).
@export var mission_waypoints: Array[Vector3] = [
	Vector3(350.0, 320.0, -250.0),   # WP 1: Initial ascent checkpoint
	Vector3(850.0, 680.0, -650.0),   # WP 2: Crosswind transition waypoint
	Vector3(1450.0, 950.0, -200.0)   # WP 3: Final target loiter station
]
## Waypoint capture acceptance radius (meters).
@export var waypoint_arrival_radius: float = 35.0
## Initial launch altitude above ground level (meters).
@export var initial_altitude: float = 11.0
## GNSS horizontal Gaussian noise standard deviation (meters).
@export var gnss_noise_horizontal_std: float = 1.2
## GNSS vertical Gaussian noise standard deviation (meters).
@export var gnss_noise_vertical_std: float = 2.4
## Barometer noise standard deviation (Pascals).
@export var baro_noise_std: float = 3.5
## IMU accelerometer noise standard deviation (m/s^2).
@export var imu_accel_noise_std: float = 0.025
## IMU gyroscope noise standard deviation (rad/s).
@export var imu_gyro_noise_std: float = 0.006

func calculate_total_mass() -> float:
	var helium_mass: float = envelope_volume * helium_density_sl
	return envelope_mass + payload_mass + motor_frame_mass + rigging_mass + ballast_mass + helium_mass
