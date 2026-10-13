class_name TrajectoryPredictor
extends Node

## Calculates forward physics-based flight trajectory predictions and tracks historical flight path.

signal prediction_updated(history_points: PackedVector3Array, predicted_points: PackedVector3Array, ground_track: PackedVector3Array)

@export var config: SimulationConfig
@export var wind_field: WindField
@export var prediction_horizon_sec: float = 90.0 # Future forecast window (seconds)
@export var prediction_step_sec: float = 2.5 # Integration step size
@export var history_sample_interval_sec: float = 1.0 # Recording interval

var historical_points: PackedVector3Array = PackedVector3Array()
var predicted_points: PackedVector3Array = PackedVector3Array()
var ground_track_points: PackedVector3Array = PackedVector3Array()

var _history_timer: float = 0.0
var _prediction_timer: float = 0.0
const PREDICTION_UPDATE_INTERVAL: float = 0.4 # Recompute forecast 2.5 times per second

func _ready() -> void:
	if config == null:
		config = SimulationConfig.new()

func reset_trajectory() -> void:
	historical_points.clear()
	predicted_points.clear()
	ground_track_points.clear()
	_history_timer = 0.0
	_prediction_timer = 0.0

func update_trajectory(current_pos: Vector3, current_vel: Vector3, total_mass: float, trim_force: float, thrust_vec: Vector3, current_time: float, delta: float) -> void:
	if delta <= 0.0:
		return

	_history_timer += delta
	_prediction_timer += delta

	# 1. Record historical points
	if _history_timer >= history_sample_interval_sec:
		_history_timer = 0.0
		historical_points.append(current_pos)
		# Cap history length to avoid excessive vertex memory
		if historical_points.size() > 800:
			historical_points.remove_at(0)

	# 2. Recompute forward physics forecast
	if _prediction_timer >= PREDICTION_UPDATE_INTERVAL:
		_prediction_timer = 0.0
		_compute_forward_forecast(current_pos, current_vel, total_mass, trim_force, thrust_vec, current_time)
		prediction_updated.emit(historical_points, predicted_points, ground_track_points)

func _compute_forward_forecast(init_pos: Vector3, init_vel: Vector3, mass: float, trim_force: float, thrust_vec: Vector3, start_time: float) -> void:
	predicted_points.clear()
	ground_track_points.clear()

	var sim_pos: Vector3 = init_pos
	var sim_vel: Vector3 = init_vel
	var sim_time: float = start_time
	var steps: int = int(prediction_horizon_sec / prediction_step_sec)

	predicted_points.append(sim_pos)
	ground_track_points.append(Vector3(sim_pos.x, 0.2, sim_pos.z))

	for i in range(steps):
		# Sub-step forward integration for unconditional numerical stability
		var sub_dt: float = 0.25
		var sub_steps: int = int(prediction_step_sec / sub_dt)

		for s in range(sub_steps):
			sim_time += sub_dt
			var alt: float = max(0.0, sim_pos.y)

			# 1. ISA Air Density
			var temp_k: float = max(216.65, config.sea_level_temp_k - config.lapse_rate * alt)
			var temp_ratio: float = temp_k / config.sea_level_temp_k
			var exponent: float = (config.gravity * config.molar_mass_air) / (config.gas_constant_universal * config.lapse_rate)
			var pressure: float = config.sea_level_pressure * pow(temp_ratio, exponent)
			var rho: float = pressure / (config.gas_constant_air * temp_k)

			# 2. Local wind velocity at predicted position
			var wind_v: Vector3 = wind_field.get_wind_velocity(sim_pos, sim_time) if wind_field != null else Vector3.ZERO

			# 3. Air-relative velocity
			var v_rel: Vector3 = sim_vel - wind_v
			var rel_speed: float = v_rel.length()

			# 4. Drag force
			var drag_area: float = config.envelope_reference_area * config.envelope_drag_coeff + config.payload_reference_area * config.payload_drag_coeff
			var drag_mag: float = 0.5 * rho * drag_area * (rel_speed * rel_speed)
			var f_drag: Vector3 = -v_rel.normalized() * drag_mag if rel_speed > 0.001 else Vector3.ZERO

			# 5. Buoyancy & Gravity
			var f_buoyancy: float = rho * config.envelope_volume * config.gravity
			var f_gravity: float = -mass * config.gravity

			# 6. Actuation
			var f_total: Vector3 = Vector3(0.0, f_buoyancy + f_gravity + trim_force, 0.0) + f_drag + thrust_vec

			# 7. Step integration
			var accel: Vector3 = f_total / max(1.0, mass)
			sim_vel += accel * sub_dt
			sim_pos += sim_vel * sub_dt

			if sim_pos.y <= 0.0:
				sim_pos.y = 0.0
				break

		if sim_pos.y <= 0.0:
			predicted_points.append(sim_pos)
			ground_track_points.append(Vector3(sim_pos.x, 0.2, sim_pos.z))
			break

		predicted_points.append(sim_pos)
		ground_track_points.append(Vector3(sim_pos.x, 0.2, sim_pos.z))
