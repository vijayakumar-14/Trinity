class_name BalloonPhysics
extends Node3D

## Core 6-DOF aerodynamic and buoyant flight physics engine for the research balloon assembly.

signal state_updated(state: Dictionary)

@export var config: SimulationConfig
@export var wind_field: WindField

# State variables
var position_world: Vector3 = Vector3.ZERO
var velocity_world: Vector3 = Vector3.ZERO # Ground-relative velocity (m/s)
var acceleration_world: Vector3 = Vector3.ZERO # (m/s^2)
var air_relative_velocity: Vector3 = Vector3.ZERO # (m/s)
var local_wind_velocity: Vector3 = Vector3.ZERO # (m/s)

# Physical state properties
var current_air_density: float = 1.225
var current_air_pressure: float = 101325.0
var current_air_temp_k: float = 288.15
var gross_buoyant_force: float = 0.0
var net_vertical_force: float = 0.0
var total_mass_kg: float = 35.0

# Controllable actuation inputs from EdgeAINavigator and 4 BLDC Motors
var buoyancy_trim_force: float = 0.0 # Vertical trim force (N)
var motor_thrust_vector_world: Vector3 = Vector3.ZERO # Net 4-BLDC thrust in world coordinates (N)
var motor_net_torque_nm: float = 0.0 # Net yaw reaction and moment torque (N*m)

# Orientation state
var current_yaw_rad: float = 0.0
var yaw_rate_rad_s: float = 0.0

# Simulation clock
var simulation_time: float = 0.0
var is_active: bool = true

func _ready() -> void:
	if config == null:
		config = SimulationConfig.new()
	position_world = Vector3(0.0, config.initial_altitude, 0.0)
	if is_inside_tree():
		global_position = position_world
	else:
		position = position_world

func reset_simulation(init_pos: Vector3 = Vector3.ZERO) -> void:
	if init_pos == Vector3.ZERO:
		position_world = Vector3(0.0, config.initial_altitude, 0.0)
	else:
		position_world = init_pos
	velocity_world = Vector3.ZERO
	acceleration_world = Vector3.ZERO
	air_relative_velocity = Vector3.ZERO
	buoyancy_trim_force = 0.0
	motor_thrust_vector_world = Vector3.ZERO
	motor_net_torque_nm = 0.0
	current_yaw_rad = 0.0
	yaw_rate_rad_s = 0.0
	simulation_time = 0.0
	if is_inside_tree():
		global_position = position_world
	else:
		position = position_world

func physics_step(delta: float) -> void:
	if not is_active or delta <= 0.0:
		return

	simulation_time += delta
	var altitude: float = max(0.0, position_world.y)

	# 1. Atmospheric calculations (ISA Model)
	_update_atmospheric_state(altitude)

	# 2. Sample local atmospheric wind field
	if wind_field != null:
		local_wind_velocity = wind_field.get_wind_velocity(position_world, simulation_time)
	else:
		local_wind_velocity = Vector3.ZERO

	# 3. Air-relative velocity vector: v_rel = v_balloon - v_wind
	air_relative_velocity = velocity_world - local_wind_velocity

	# 4. Helium & system mass calculation
	var helium_density: float = current_air_density * (config.molar_mass_helium / config.molar_mass_air)
	var helium_mass: float = config.envelope_volume * helium_density
	total_mass_kg = config.envelope_mass + config.payload_mass + config.motor_frame_mass + config.rigging_mass + config.ballast_mass + helium_mass

	# 5. Buoyancy force: F_buoyancy = rho_air * V * g (directed along +Y)
	gross_buoyant_force = current_air_density * config.envelope_volume * config.gravity
	var f_buoyancy_vec: Vector3 = Vector3(0.0, gross_buoyant_force, 0.0)

	# 6. Gravity force: F_gravity = -m_total * g (directed along -Y)
	var f_gravity_vec: Vector3 = Vector3(0.0, -total_mass_kg * config.gravity, 0.0)

	# 7. Aerodynamic drag force: F_drag = -0.5 * rho * Cd * A * |v_rel| * v_rel
	var rel_speed: float = air_relative_velocity.length()
	var envelope_drag_mag: float = 0.5 * current_air_density * config.envelope_drag_coeff * config.envelope_reference_area * (rel_speed * rel_speed)
	var payload_drag_mag: float = 0.5 * current_air_density * config.payload_drag_coeff * config.payload_reference_area * (rel_speed * rel_speed)
	var total_drag_mag: float = envelope_drag_mag + payload_drag_mag

	var f_drag_vec: Vector3 = Vector3.ZERO
	if rel_speed > 0.0001:
		f_drag_vec = -air_relative_velocity.normalized() * total_drag_mag

	# 8. Actuation forces (buoyancy trim + 4 BLDC motor thrust forces)
	var f_actuation_vec: Vector3 = Vector3(0.0, buoyancy_trim_force, 0.0) + motor_thrust_vector_world

	# 9. Total net force
	var f_total_vec: Vector3 = f_buoyancy_vec + f_gravity_vec + f_drag_vec + f_actuation_vec
	net_vertical_force = f_total_vec.y

	# 10. Acceleration and numerical integration (Newton's 2nd Law)
	acceleration_world = f_total_vec / total_mass_kg
	velocity_world += acceleration_world * delta
	position_world += velocity_world * delta

	# Yaw rotation dynamics from 4-motor differential torque
	var yaw_accel: float = (motor_net_torque_nm / 4.5) - 1.2 * yaw_rate_rad_s
	yaw_rate_rad_s += yaw_accel * delta
	current_yaw_rad += yaw_rate_rad_s * delta
	rotation.y = current_yaw_rad

	# Ground contact boundary
	if position_world.y < 0.0:
		position_world.y = 0.0
		if velocity_world.y < 0.0:
			velocity_world.y = 0.0
		# Ground friction damping on horizontal velocity
		velocity_world.x *= 0.8
		velocity_world.z *= 0.8

	# Update 3D scene node transform
	if is_inside_tree():
		global_position = position_world
	else:
		position = position_world

	# Emit state dictionary for telemetry and avionics
	var state_dict: Dictionary = {
		"timestamp": simulation_time,
		"position": position_world,
		"velocity_ground": velocity_world,
		"velocity_air_rel": air_relative_velocity,
		"wind_velocity": local_wind_velocity,
		"acceleration": acceleration_world,
		"altitude": position_world.y,
		"air_density": current_air_density,
		"air_pressure": current_air_pressure,
		"air_temp_k": current_air_temp_k,
		"gross_buoyant_force": gross_buoyant_force,
		"net_vertical_force": net_vertical_force,
		"total_mass": total_mass_kg
	}
	state_updated.emit(state_dict)

## Computes atmospheric state using the International Standard Atmosphere (ISA).
func _update_atmospheric_state(alt: float) -> void:
	# Troposphere temperature lapse rate
	current_air_temp_k = max(216.65, config.sea_level_temp_k - config.lapse_rate * alt)
	
	# Barometric formula
	var temp_ratio: float = current_air_temp_k / config.sea_level_temp_k
	var exponent: float = (config.gravity * config.molar_mass_air) / (config.gas_constant_universal * config.lapse_rate)
	current_air_pressure = config.sea_level_pressure * pow(temp_ratio, exponent)

	# Ideal gas law for dry air: rho = P / (R_spec * T)
	current_air_density = current_air_pressure / (config.gas_constant_air * current_air_temp_k)
