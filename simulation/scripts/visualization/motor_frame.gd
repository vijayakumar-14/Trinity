class_name MotorFrame
extends Node3D

## Lower rigid structural frame supporting the 4 BLDC motor pods, arms, and suspension attachment joints.

signal motors_updated(telemetry_array: Array)

@export var config: SimulationConfig

var motors: Array[BLDCMotor] = []
var _arm_instances: Array[MeshInstance3D] = []
var _cable_attach_points: Array[Node3D] = []

func _ready() -> void:
	if config == null:
		config = SimulationConfig.new()
	_build_structural_arms()
	_instantiate_motors()

## Constructs 4 carbon-fiber tubular arms extending diagonally to each motor mount.
func _build_structural_arms() -> void:
	var cf_mat: StandardMaterial3D = StandardMaterial3D.new()
	cf_mat.albedo_color = Color(0.20, 0.22, 0.25) # High-grade twill carbon fiber
	cf_mat.roughness = 0.35
	cf_mat.metallic = 0.35

	var joint_mat: StandardMaterial3D = StandardMaterial3D.new()
	joint_mat.albedo_color = Color(0.88, 0.90, 0.94) # CNC billet aviation aluminum
	joint_mat.metallic = 0.95
	joint_mat.roughness = 0.20

	# Central structural hub plate (sandwich carbon & aluminum)
	var hub_mesh: BoxMesh = BoxMesh.new()
	hub_mesh.size = Vector3(0.42, 0.020, 0.42)
	var hub_inst: MeshInstance3D = MeshInstance3D.new()
	hub_inst.mesh = hub_mesh
	hub_inst.material_override = cf_mat
	add_child(hub_inst)

	# Billet aluminum edge perimeter trim on hub
	var trim_mesh: BoxMesh = BoxMesh.new()
	trim_mesh.size = Vector3(0.43, 0.008, 0.43)
	var trim_inst: MeshInstance3D = MeshInstance3D.new()
	trim_inst.mesh = trim_mesh
	trim_inst.material_override = joint_mat
	trim_inst.position = Vector3(0.0, -0.012, 0.0)
	add_child(trim_inst)

	# 4 Tubular carbon-fiber arms extending to motor positions
	for i in range(4):
		var target_pos: Vector3 = config.motor_positions[i]
		var arm_len: float = target_pos.length()

		var arm_tube: CylinderMesh = CylinderMesh.new()
		arm_tube.top_radius = 0.018 # Sturdy 36mm carbon tube
		arm_tube.bottom_radius = 0.018
		arm_tube.height = arm_len

		var arm_inst: MeshInstance3D = MeshInstance3D.new()
		arm_inst.mesh = arm_tube
		arm_inst.material_override = cf_mat

		var mid_p: Vector3 = target_pos * 0.5
		arm_inst.position = mid_p

		var dir: Vector3 = target_pos.normalized()
		var up: Vector3 = Vector3.UP
		if abs(dir.dot(up)) > 0.99:
			up = Vector3.FORWARD
		var look_t: Transform3D = Transform3D().looking_at(dir, up)
		arm_inst.transform = look_t * Transform3D(Basis(Vector3.RIGHT, deg_to_rad(90.0)), mid_p)
		add_child(arm_inst)
		_arm_instances.append(arm_inst)

		# CNC Aluminum motor tip clamp collar
		var tip_collar: CylinderMesh = CylinderMesh.new()
		tip_collar.top_radius = 0.022
		tip_collar.bottom_radius = 0.022
		tip_collar.height = 0.04
		var tip_inst: MeshInstance3D = MeshInstance3D.new()
		tip_inst.mesh = tip_collar
		tip_inst.material_override = joint_mat
		tip_inst.transform = look_t * Transform3D(Basis(Vector3.RIGHT, deg_to_rad(90.0)), target_pos * 0.92)
		add_child(tip_inst)

		# Suspension cable attachment eyelet on each arm
		var eye_node: Node3D = Node3D.new()
		eye_node.name = "CableAnchor_M%d" % (i + 1)
		eye_node.position = target_pos * 0.85 + Vector3(0.0, 0.025, 0.0)
		add_child(eye_node)

		var eye_mesh: TorusMesh = TorusMesh.new()
		eye_mesh.inner_radius = 0.010
		eye_mesh.outer_radius = 0.018
		var eye_inst: MeshInstance3D = MeshInstance3D.new()
		eye_inst.mesh = eye_mesh
		eye_inst.material_override = joint_mat
		eye_inst.rotation_degrees = Vector3(90.0, 0.0, 0.0)
		eye_node.add_child(eye_inst)
		_cable_attach_points.append(eye_node)

## Instantiates the 4 BLDC Motor assemblies M1, M2, M3, M4.
func _instantiate_motors() -> void:
	for i in range(4):
		var m: BLDCMotor = BLDCMotor.new()
		m.motor_id = i + 1
		m.motor_name = "M%d" % (i + 1)
		m.mount_offset_local = config.motor_positions[i]
		m.thrust_direction_local = config.motor_thrust_directions[i]
		m.spin_direction = config.motor_spin_directions[i]
		m.max_rpm = config.motor_max_rpm
		m.min_rpm = config.motor_min_rpm
		m.kt = config.motor_kt
		m.kq = config.motor_kq
		m.time_constant_sec = config.motor_time_constant
		m.idle_power_watts = config.motor_idle_power_watts
		m.power_coeff = config.motor_power_coeff
		add_child(m)
		if not is_inside_tree():
			m._ready()
		motors.append(m)

## Applies motor throttle commands (array of 4 floats: [u1, u2, u3, u4] from -1.0 to 1.0).
func set_motor_throttles(throttles: Array[float]) -> void:
	for i in range(min(throttles.size(), motors.size())):
		motors[i].set_throttle(throttles[i])

## Updates physics for all 4 motors and returns net force and torque in local frame coordinates.
func update_motors_physics(delta: float) -> Dictionary:
	var net_force_local: Vector3 = Vector3.ZERO
	var net_torque_local: Vector3 = Vector3.ZERO
	var total_power_watts: float = 0.0
	var telemetry_list: Array = []

	for m in motors:
		m.update_motor_physics(delta)
		var f_i: Vector3 = m.get_frame_thrust_vector()
		var r_i: Vector3 = m.mount_offset_local

		# Translational thrust accumulation
		net_force_local += f_i

		# Moment: tau = r x F + reaction torque about thrust axis
		var arm_torque: Vector3 = r_i.cross(f_i)
		var spin_torque: Vector3 = m.thrust_direction_local * m.current_reaction_torque_nm
		net_torque_local += (arm_torque + spin_torque)

		total_power_watts += m.current_power_watts
		telemetry_list.append({
			"id": m.motor_id,
			"name": m.motor_name,
			"rpm": m.current_rpm,
			"commanded_rpm": m.commanded_rpm,
			"thrust_n": m.current_thrust_n,
			"torque_nm": m.current_reaction_torque_nm,
			"power_w": m.current_power_watts,
			"temp_c": m.esc_temperature_c,
			"is_healthy": not m.is_failed,
			"position": m.mount_offset_local,
			"thrust_direction": m.thrust_direction_local,
			"spin_direction": m.spin_direction
		})

	motors_updated.emit(telemetry_list)

	return {
		"net_force_local": net_force_local,
		"net_torque_local": net_torque_local,
		"total_power_watts": total_power_watts,
		"telemetry": telemetry_list
	}

## Returns world positions of the 4 suspension cable attachment points.
func get_suspension_anchor_positions() -> Array[Vector3]:
	var anchors: Array[Vector3] = []
	for node in _cable_attach_points:
		if is_inside_tree():
			anchors.append(node.global_position)
		else:
			anchors.append(node.position)
	return anchors
