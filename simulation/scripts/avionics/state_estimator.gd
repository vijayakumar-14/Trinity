class_name StateEstimator
extends Node

## Layer A: Sensor fusion and state estimation subsystem.
## Fuses noisy GNSS, IMU, Barometer, and motor RPM telemetry into a robust state estimate.
## Features dead-reckoning fallback during simulated GNSS dropouts (Scenario 9).

signal state_estimated(est: Dictionary)

@export var config: SimulationConfig

# Estimated flight state
var est_position: Vector3 = Vector3.ZERO
var est_velocity: Vector3 = Vector3.ZERO
var est_altitude_m: float = 10.0
var est_heading_deg: float = 0.0
var est_pitch_deg: float = 0.0
var est_roll_deg: float = 0.0
var est_wind_velocity: Vector3 = Vector3.ZERO
var est_wind_confidence: float = 0.9

# Motor telemetry feedback cache
var motor_rpm_feedback: Array[float] = [0.0, 0.0, 0.0, 0.0]
var motor_health_feedback: Array[bool] = [true, true, true, true]

# Sensor health & dropout tracking
var gnss_dropout_active: bool = false
var gnss_dropout_timer: float = 0.0
var estimation_confidence: float = 0.92

# Dead reckoning state variables
var _dr_position: Vector3 = Vector3.ZERO
var _dr_velocity: Vector3 = Vector3.ZERO

func _ready() -> void:
	if config == null:
		config = SimulationConfig.new()
	est_altitude_m = config.initial_altitude
	est_position = Vector3(0.0, config.initial_altitude, 0.0)

## Processes incoming noisy sensor observations and updates estimated state.
func update_estimator(sensor_obs: Dictionary, motors_data: Array, delta: float) -> Dictionary:
	if delta <= 0.0:
		return get_estimated_state()

	var gnss: Dictionary = sensor_obs.get("gnss", {})
	var baro: Dictionary = sensor_obs.get("barometer", {})
	var imu: Dictionary = sensor_obs.get("imu", {})
	var wind_est: Dictionary = sensor_obs.get("wind_estimator", {})
	var batt: Dictionary = sensor_obs.get("battery", {})

	# Cache motor feedback
	for i in range(min(motors_data.size(), 4)):
		var m_dict: Dictionary = motors_data[i]
		motor_rpm_feedback[i] = m_dict.get("rpm", 0.0)
		motor_health_feedback[i] = m_dict.get("is_healthy", true)

	# IMU attitude estimation
	est_pitch_deg = imu.get("pitch_deg", 0.0)
	est_roll_deg = imu.get("roll_deg", 0.0)

	# Fused barometric altitude
	var baro_alt: float = baro.get("altitude_m", 0.0)

	# GNSS Fusion vs Dead-Reckoning (Handling Scenario 9 GNSS dropout)
	var gnss_valid: bool = gnss.get("fix_valid", true) and not gnss_dropout_active

	if gnss_valid:
		var raw_gnss_pos: Vector3 = gnss.get("position", Vector3.ZERO)
		var raw_gnss_vel: float = gnss.get("ground_speed", 0.0)
		var raw_gnss_trk: float = gnss.get("track_deg", 0.0)

		# Complementary filter for position (smooths Gaussian GNSS jitter)
		est_position = est_position.lerp(raw_gnss_pos, delta * 3.5)
		# Blend GNSS altitude with fast barometric altitude
		est_position.y = lerp(raw_gnss_pos.y, baro_alt, 0.4)
		est_altitude_m = est_position.y

		# Velocity decomposition from speed and track
		var trk_rad: float = deg_to_rad(raw_gnss_trk)
		var vx: float = raw_gnss_vel * sin(trk_rad)
		var vz: float = -raw_gnss_vel * cos(trk_rad)
		est_velocity = est_velocity.lerp(Vector3(vx, 0.0, vz), delta * 4.0)

		est_heading_deg = raw_gnss_trk
		estimation_confidence = 0.95
		_dr_position = est_position
		_dr_velocity = est_velocity
	else:
		# GNSS Dropout: Dead-reckoning integration via IMU acceleration + Barometer
		var accel: Vector3 = imu.get("accel", Vector3(0.0, 9.81, 0.0))
		# Subtract 1G reaction gravity
		var lin_accel_x: float = accel.x
		var lin_accel_z: float = accel.z

		_dr_velocity.x += lin_accel_x * delta
		_dr_velocity.z += lin_accel_z * delta
		_dr_position += _dr_velocity * delta
		_dr_position.y = baro_alt # Barometer still provides altitude

		est_position = _dr_position
		est_altitude_m = baro_alt
		est_velocity = _dr_velocity

		# Confidence decays over dead-reckoning time
		estimation_confidence = max(0.40, estimation_confidence - delta * 0.03)

	# Wind estimator feedback
	est_wind_velocity = wind_est.get("estimated_vector", Vector3.ZERO)
	est_wind_confidence = wind_est.get("confidence", 0.85)

	var output_state: Dictionary = get_estimated_state()
	output_state["battery_percent"] = batt.get("percent", 100.0)
	output_state["battery_voltage"] = batt.get("voltage_v", 16.0)
	state_estimated.emit(output_state)
	return output_state

func set_gnss_dropout(dropout: bool) -> void:
	gnss_dropout_active = dropout

func get_estimated_state() -> Dictionary:
	return {
		"position": est_position,
		"velocity": est_velocity,
		"altitude": est_altitude_m,
		"heading_deg": est_heading_deg,
		"pitch_deg": est_pitch_deg,
		"roll_deg": est_roll_deg,
		"wind_velocity": est_wind_velocity,
		"wind_confidence": est_wind_confidence,
		"motor_rpm": motor_rpm_feedback.duplicate(),
		"motor_health": motor_health_feedback.duplicate(),
		"estimation_confidence": estimation_confidence,
		"is_gnss_dropout": gnss_dropout_active
	}
