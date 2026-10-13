class_name SensorSimulator
extends Node

## Simulates onboard avionics sensors with realistic sampling rates, quantization, and noise.
## Strictly enforces separation between ground-truth simulation state and noisy AI observations.

signal observations_ready(observations: Dictionary)

@export var config: SimulationConfig
@export var noise_enabled: bool = true

# Sampling rates (Hz)
const GNSS_RATE_HZ: float = 5.0
const BARO_RATE_HZ: float = 20.0
const IMU_RATE_HZ: float = 50.0
const TEMP_RATE_HZ: float = 10.0
const WIND_EST_RATE_HZ: float = 2.0

# Timers
var _gnss_timer: float = 0.0
var _baro_timer: float = 0.0
var _imu_timer: float = 0.0
var _temp_timer: float = 0.0
var _wind_est_timer: float = 0.0

# Latest sensor readings cache
var gnss_position: Vector3 = Vector3.ZERO
var gnss_altitude: float = 0.0
var gnss_ground_speed: float = 0.0
var gnss_track_deg: float = 0.0
var gnss_sats_locked: int = 12
var gnss_hdop: float = 0.9

var baro_pressure_pa: float = 101325.0
var baro_altitude_m: float = 0.0

var imu_accel: Vector3 = Vector3(0.0, 9.81, 0.0)
var imu_gyro: Vector3 = Vector3.ZERO
var imu_pitch_deg: float = 0.0
var imu_roll_deg: float = 0.0

var ambient_temp_c: float = 15.0

var estimated_wind_vector: Vector3 = Vector3.ZERO
var wind_estimate_confidence: float = 0.85

var battery_percent: float = 100.0
var battery_voltage: float = 16.4 # Fully charged 4S LiPo
var battery_current_amps: float = 1.2
var total_energy_used_wh: float = 0.0

# Deterministic random generator for noise
var _rng: RandomNumberGenerator

func _init() -> void:
	_rng = RandomNumberGenerator.new()
	_rng.seed = 1337

func _ready() -> void:
	if config == null:
		config = SimulationConfig.new()
	if _rng == null:
		_rng = RandomNumberGenerator.new()
		_rng.seed = 1337

func update_sensors(ground_truth: Dictionary, payload_tilt_deg: Vector3, thruster_active: bool, delta: float) -> void:
	if delta <= 0.0:
		return

	_gnss_timer += delta
	_baro_timer += delta
	_imu_timer += delta
	_temp_timer += delta
	_wind_est_timer += delta

	var true_pos: Vector3 = ground_truth.get("position", Vector3.ZERO)
	var true_vel: Vector3 = ground_truth.get("velocity_ground", Vector3.ZERO)
	var true_wind: Vector3 = ground_truth.get("wind_velocity", Vector3.ZERO)
	var true_press: float = ground_truth.get("air_pressure", 101325.0)
	var true_temp_k: float = ground_truth.get("air_temp_k", 288.15)
	var true_accel: Vector3 = ground_truth.get("acceleration", Vector3.ZERO)

	# 1. GNSS update
	if _gnss_timer >= (1.0 / GNSS_RATE_HZ):
		_gnss_timer = 0.0
		var noise_h_x: float = _rng.randf_range(-config.gnss_noise_horizontal_std, config.gnss_noise_horizontal_std) if noise_enabled else 0.0
		var noise_h_z: float = _rng.randf_range(-config.gnss_noise_horizontal_std, config.gnss_noise_horizontal_std) if noise_enabled else 0.0
		var noise_v: float = _rng.randf_range(-config.gnss_noise_vertical_std, config.gnss_noise_vertical_std) if noise_enabled else 0.0

		gnss_position = Vector3(true_pos.x + noise_h_x, true_pos.y + noise_v, true_pos.z + noise_h_z)
		gnss_altitude = max(0.0, gnss_position.y)

		var h_vel: Vector2 = Vector2(true_vel.x, true_vel.z)
		var speed_noise: float = _rng.randf_range(-0.15, 0.15) if noise_enabled else 0.0
		gnss_ground_speed = max(0.0, h_vel.length() + speed_noise)

		if h_vel.length() > 0.1:
			gnss_track_deg = fposmod(rad_to_deg(atan2(h_vel.x, -h_vel.y)), 360.0)

		gnss_sats_locked = int(clamp(12 + _rng.randi_range(-1, 2), 7, 16))
		gnss_hdop = clamp(0.85 + _rng.randf_range(-0.1, 0.15), 0.7, 1.8)

	# 2. Barometer update
	if _baro_timer >= (1.0 / BARO_RATE_HZ):
		_baro_timer = 0.0
		var baro_noise: float = _rng.randf_range(-config.baro_noise_std, config.baro_noise_std) if noise_enabled else 0.0
		baro_pressure_pa = max(100.0, true_press + baro_noise)

		# Convert pressure to barometric altitude using ISA hypsometric equation
		var temp_ratio: float = pow(baro_pressure_pa / config.sea_level_pressure, (config.gas_constant_universal * config.lapse_rate) / (config.gravity * config.molar_mass_air))
		baro_altitude_m = (config.sea_level_temp_k / config.lapse_rate) * (1.0 - temp_ratio)

	# 3. IMU update
	if _imu_timer >= (1.0 / IMU_RATE_HZ):
		_imu_timer = 0.0
		var ax_noise: float = _rng.randf_range(-config.imu_accel_noise_std, config.imu_accel_noise_std) if noise_enabled else 0.0
		var ay_noise: float = _rng.randf_range(-config.imu_accel_noise_std, config.imu_accel_noise_std) if noise_enabled else 0.0
		var az_noise: float = _rng.randf_range(-config.imu_accel_noise_std, config.imu_accel_noise_std) if noise_enabled else 0.0

		# IMU measures proper acceleration: linear accel + 1G reaction vector
		imu_accel = Vector3(true_accel.x + ax_noise, true_accel.y + config.gravity + ay_noise, true_accel.z + az_noise)

		var gx_noise: float = _rng.randf_range(-config.imu_gyro_noise_std, config.imu_gyro_noise_std) if noise_enabled else 0.0
		var gy_noise: float = _rng.randf_range(-config.imu_gyro_noise_std, config.imu_gyro_noise_std) if noise_enabled else 0.0
		var gz_noise: float = _rng.randf_range(-config.imu_gyro_noise_std, config.imu_gyro_noise_std) if noise_enabled else 0.0
		imu_gyro = Vector3(gx_noise, gy_noise, gz_noise)

		imu_pitch_deg = payload_tilt_deg.x + (_rng.randf_range(-0.2, 0.2) if noise_enabled else 0.0)
		imu_roll_deg = payload_tilt_deg.z + (_rng.randf_range(-0.2, 0.2) if noise_enabled else 0.0)

	# 4. Temperature sensor update
	if _temp_timer >= (1.0 / TEMP_RATE_HZ):
		_temp_timer = 0.0
		var t_noise: float = _rng.randf_range(-0.25, 0.25) if noise_enabled else 0.0
		ambient_temp_c = (true_temp_k - 273.15) + t_noise

	# 5. Wind Estimator filter (complementary filter simulating onboard estimation)
	if _wind_est_timer >= (1.0 / WIND_EST_RATE_HZ):
		_wind_est_timer = 0.0
		# Wind estimator filters GNSS drift: in passive drift, wind ~= ground speed
		var wind_noise_x: float = _rng.randf_range(-0.4, 0.4) if noise_enabled else 0.0
		var wind_noise_z: float = _rng.randf_range(-0.4, 0.4) if noise_enabled else 0.0
		var noisy_wind: Vector3 = Vector3(true_wind.x + wind_noise_x, 0.0, true_wind.z + wind_noise_z)
		estimated_wind_vector = estimated_wind_vector.lerp(noisy_wind, 0.4)
		wind_estimate_confidence = clamp(0.92 - (0.1 if noise_enabled else 0.0), 0.5, 0.99)

	# 6. Battery discharge dynamics
	var power_watts: float = config.idle_power_watts + config.ai_compute_power_watts
	if thruster_active:
		power_watts += config.thruster_power_watts

	battery_current_amps = power_watts / max(10.0, battery_voltage)
	var energy_step_wh: float = (power_watts * delta) / 3600.0
	total_energy_used_wh += energy_step_wh
	battery_percent = max(0.0, 100.0 * (1.0 - (total_energy_used_wh / config.battery_capacity_wh)))

	# 4S LiPo discharge voltage curve (16.8V max down to 13.2V cutoff)
	battery_voltage = 13.2 + (battery_percent / 100.0) * 3.6

	# Emit latest observation dictionary
	var obs: Dictionary = get_sensor_observations()
	observations_ready.emit(obs)

## Public interface for EdgeAINavigator to consume. Strictly returns sensor readings.
func get_sensor_observations() -> Dictionary:
	return {
		"gnss": {
			"position": gnss_position,
			"altitude": gnss_altitude,
			"ground_speed": gnss_ground_speed,
			"track_deg": gnss_track_deg,
			"sats_locked": gnss_sats_locked,
			"hdop": gnss_hdop,
			"fix_valid": gnss_sats_locked >= 6
		},
		"barometer": {
			"pressure_pa": baro_pressure_pa,
			"altitude_m": baro_altitude_m
		},
		"imu": {
			"accel": imu_accel,
			"gyro": imu_gyro,
			"pitch_deg": imu_pitch_deg,
			"roll_deg": imu_roll_deg
		},
		"temperature": {
			"ambient_c": ambient_temp_c
		},
		"wind_estimator": {
			"estimated_vector": estimated_wind_vector,
			"estimated_speed": Vector2(estimated_wind_vector.x, estimated_wind_vector.z).length(),
			"estimated_bearing_deg": fposmod(rad_to_deg(atan2(estimated_wind_vector.x, -estimated_wind_vector.z)), 360.0),
			"confidence": wind_estimate_confidence
		},
		"battery": {
			"percent": battery_percent,
			"voltage_v": battery_voltage,
			"current_a": battery_current_amps,
			"energy_used_wh": total_energy_used_wh
		}
	}
