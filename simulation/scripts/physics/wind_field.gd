class_name WindField
extends Node

## Atmospheric wind field subsystem with altitude shear, gusts, updrafts, and 10 engineering scenarios.

enum Scenario {
	CALM_ASCENT = 0,
	CROSSWIND_DRIFT = 1,
	STRONG_WIND_CORRECTION = 2,
	GUST_DISTURBANCE = 3,
	DIRECTION_REVERSAL = 4,
	WAYPOINT_NAVIGATION = 5,
	BATTERY_DEPLETION = 6,
	MOTOR_FAILURE = 7,
	GNSS_DROPOUT = 8,
	EXTERNAL_AI_DISCONNECT = 9
}

@export var current_scenario: Scenario = Scenario.WAYPOINT_NAVIGATION
@export var base_speed: float = 8.0 # m/s
@export var base_direction_deg: float = 65.0 # Degrees (0 = North/-Z, 90 = East/+X)
@export var turbulence_intensity: float = 0.25 # 0.0 to 1.0 scale
@export var vertical_updraft_max: float = 0.0 # m/s
@export var random_seed: int = 42

var _noise: FastNoiseLite
var _thermal_center: Vector2 = Vector2(400.0, -300.0)
var _thermal_radius: float = 450.0

func _init() -> void:
	_init_noise()

func _ready() -> void:
	if _noise == null:
		_init_noise()
	apply_scenario(current_scenario)

func _init_noise() -> void:
	_noise = FastNoiseLite.new()
	_noise.seed = random_seed
	_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise.frequency = 0.08
	_noise.fractal_octaves = 3

func set_seed(new_seed: int) -> void:
	random_seed = new_seed
	if _noise != null:
		_noise.seed = new_seed

## Core API: Computes the 3D wind velocity vector (in world space, m/s) at any given position and time.
func get_wind_velocity(pos: Vector3, time: float) -> Vector3:
	var altitude: float = max(0.0, pos.y)
	var horizontal_wind: Vector3 = _compute_altitude_horizontal_wind(altitude)
	var gust_vec: Vector3 = _compute_gusts(pos, time)
	var vertical_wind: float = _compute_vertical_wind(pos, time)

	return horizontal_wind + gust_vec + Vector3(0.0, vertical_wind, 0.0)

func _compute_altitude_horizontal_wind(alt: float) -> Vector3:
	var speed: float = base_speed
	var dir_deg: float = base_direction_deg

	match current_scenario:
		Scenario.CALM_ASCENT:
			speed = 0.8 + 0.4 * (alt / 2000.0)
			dir_deg = base_direction_deg

		Scenario.CROSSWIND_DRIFT:
			speed = 10.0 + (alt / 1000.0) * 1.5
			dir_deg = 90.0 # Pure East

		Scenario.STRONG_WIND_CORRECTION:
			speed = 16.0 + (alt / 1000.0) * 2.5
			dir_deg = base_direction_deg

		Scenario.GUST_DISTURBANCE:
			speed = 11.0 * (1.0 + 0.3 * sin(alt * 0.006))
			dir_deg = base_direction_deg + 25.0 * cos(alt * 0.005)

		Scenario.DIRECTION_REVERSAL:
			if alt < 600.0:
				speed = 8.0
				dir_deg = 80.0
			elif alt < 1200.0:
				var t: float = (alt - 600.0) / 600.0
				speed = lerp(8.0, 14.0, t)
				dir_deg = lerp(80.0, 260.0, t)
			else:
				speed = 14.0
				dir_deg = 260.0

		Scenario.WAYPOINT_NAVIGATION, Scenario.BATTERY_DEPLETION, Scenario.MOTOR_FAILURE, Scenario.GNSS_DROPOUT, Scenario.EXTERNAL_AI_DISCONNECT:
			# Multi-layer wind profile
			if alt < 500.0:
				speed = 6.0
				dir_deg = 75.0
			elif alt < 1200.0:
				var t1: float = (alt - 500.0) / 700.0
				speed = lerp(6.0, 11.0, t1)
				dir_deg = lerp(75.0, 45.0, t1)
			else:
				speed = 12.0
				dir_deg = 45.0

	var rad: float = deg_to_rad(dir_deg)
	var vx: float = speed * sin(rad)
	var vz: float = -speed * cos(rad)
	return Vector3(vx, 0.0, vz)

func _compute_gusts(pos: Vector3, time: float) -> Vector3:
	if turbulence_intensity <= 0.001 or _noise == null:
		return Vector3.ZERO

	var sample_x: float = pos.x * 0.01 + time * 0.4
	var sample_y: float = pos.y * 0.01 + time * 0.3
	var sample_z: float = pos.z * 0.01 + time * 0.4

	var gx: float = _noise.get_noise_3d(sample_x, sample_y, sample_z)
	var gy: float = _noise.get_noise_3d(sample_x + 50.0, sample_y + 50.0, sample_z + 50.0)
	var gz: float = _noise.get_noise_3d(sample_x - 50.0, sample_y - 50.0, sample_z - 50.0)

	var amp: float = turbulence_intensity * 5.0
	return Vector3(gx * amp, gy * amp * 0.4, gz * amp)

func _compute_vertical_wind(pos: Vector3, time: float) -> float:
	var w: float = 0.0
	if current_scenario == Scenario.GUST_DISTURBANCE:
		var d: float = Vector2(pos.x, pos.z).distance_to(_thermal_center)
		if d < _thermal_radius:
			var factor: float = 1.0 - (d / _thermal_radius)
			w += 3.5 * factor * sin(clamp(pos.y / 1500.0, 0.0, 1.0) * PI)

	if vertical_updraft_max != 0.0:
		w += vertical_updraft_max * (0.8 + 0.2 * sin(time * 0.2 + pos.x * 0.002))
	return w

func apply_scenario(sc: Scenario) -> void:
	current_scenario = sc
	match sc:
		Scenario.CALM_ASCENT:
			base_speed = 0.8
			base_direction_deg = 45.0
			turbulence_intensity = 0.02
			vertical_updraft_max = 0.0

		Scenario.CROSSWIND_DRIFT:
			base_speed = 10.0
			base_direction_deg = 90.0
			turbulence_intensity = 0.15
			vertical_updraft_max = 0.0

		Scenario.STRONG_WIND_CORRECTION:
			base_speed = 16.0
			base_direction_deg = 70.0
			turbulence_intensity = 0.25
			vertical_updraft_max = 0.0

		Scenario.GUST_DISTURBANCE:
			base_speed = 11.0
			base_direction_deg = 65.0
			turbulence_intensity = 0.75
			vertical_updraft_max = 2.5

		Scenario.DIRECTION_REVERSAL:
			base_speed = 8.0
			base_direction_deg = 80.0
			turbulence_intensity = 0.2
			vertical_updraft_max = 0.0

		Scenario.WAYPOINT_NAVIGATION:
			base_speed = 7.5
			base_direction_deg = 65.0
			turbulence_intensity = 0.15
			vertical_updraft_max = 0.2

		Scenario.BATTERY_DEPLETION:
			base_speed = 6.0
			base_direction_deg = 60.0
			turbulence_intensity = 0.1
			vertical_updraft_max = 0.0

		Scenario.MOTOR_FAILURE:
			base_speed = 7.0
			base_direction_deg = 65.0
			turbulence_intensity = 0.18
			vertical_updraft_max = 0.0

		Scenario.GNSS_DROPOUT:
			base_speed = 6.5
			base_direction_deg = 65.0
			turbulence_intensity = 0.15
			vertical_updraft_max = 0.0

		Scenario.EXTERNAL_AI_DISCONNECT:
			base_speed = 7.0
			base_direction_deg = 65.0
			turbulence_intensity = 0.15
			vertical_updraft_max = 0.0

func sample_sounding(alt: float) -> Dictionary:
	var v: Vector3 = _compute_altitude_horizontal_wind(alt)
	var speed: float = Vector2(v.x, v.z).length()
	var bearing: float = fposmod(rad_to_deg(atan2(v.x, -v.z)), 360.0)
	return {
		"altitude": alt,
		"velocity": v,
		"speed": speed,
		"bearing_deg": bearing
	}
