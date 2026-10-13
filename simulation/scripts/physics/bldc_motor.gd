class_name BLDCMotor
extends Node3D

## Models a single brushless DC (BLDC) motor assembly with realistic propeller dynamics,
## first-order spin-up lag, reaction torque, electrical power draw, and 3D visual geometry.

signal telemetry_updated(data: Dictionary)

@export var motor_id: int = 1 # 1 to 4
@export var motor_name: String = "M1"
@export var spin_direction: int = 1 # +1 = CW, -1 = CCW
@export var thrust_direction_local: Vector3 = Vector3(0.7071, 0.0, -0.7071)
@export var mount_offset_local: Vector3 = Vector3(0.60, 0.0, -0.60)

# Physical parameters
@export var max_rpm: float = 7200.0
@export var min_rpm: float = -7200.0
@export var kt: float = 1.1e-6 # Thrust coeff: T = kt * RPM^2 (N)
@export var kq: float = 2.2e-8 # Torque coeff: Q = kq * RPM^2 (N*m)
@export var time_constant_sec: float = 0.12 # Spin-up/spin-down response time (s)
@export var idle_power_watts: float = 2.5
@export var power_coeff: float = 2.2e-10

# State variables
var commanded_rpm: float = 0.0
var current_rpm: float = 0.0
var current_thrust_n: float = 0.0
var current_reaction_torque_nm: float = 0.0
var current_power_watts: float = 0.0
var is_failed: bool = false
var esc_temperature_c: float = 24.0

# 3D Visual Mesh Nodes
var prop_rotator_node: Node3D
var _propeller_angle_rad: float = 0.0
var _label_badge: Label3D
var _thrust_arrow: MeshInstance3D

func _ready() -> void:
	name = "BLDC_Motor_M%d" % motor_id
	position = mount_offset_local
	_build_motor_geometry()

func _process(delta: float) -> void:
	# Rotate propeller visually around thrust axis according to live RPM
	if prop_rotator_node != null and abs(current_rpm) > 1.0:
		var rps: float = current_rpm / 60.0 # revolutions per second
		_propeller_angle_rad += rps * (2.0 * PI) * delta
		prop_rotator_node.rotation.z = _propeller_angle_rad

## Updates physical motor RPM, thrust force, reaction torque, and electrical power consumption.
func update_motor_physics(delta: float) -> void:
	if delta <= 0.0:
		return

	if is_failed:
		commanded_rpm = 0.0

	# First-order actuator response (spin-up / spin-down lag)
	var target: float = clamp(commanded_rpm, min_rpm, max_rpm)
	if is_failed:
		target = 0.0

	var alpha: float = clamp(delta / max(0.01, time_constant_sec), 0.0, 1.0)
	current_rpm = lerp(current_rpm, target, alpha)

	# Very small RPM threshold snapping
	if abs(current_rpm) < 2.0:
		current_rpm = 0.0

	# Calculate aerodynamic thrust: T = sgn(RPM) * kT * RPM^2
	var rpm_sq: float = current_rpm * current_rpm
	var dir_sign: float = sign(current_rpm) if current_rpm != 0.0 else 1.0
	current_thrust_n = dir_sign * kt * rpm_sq

	# Calculate motor reaction torque: Q = -spin_direction * kQ * RPM^2
	# Reaction torque opposes propeller angular acceleration and aerodynamic drag
	current_reaction_torque_nm = -float(spin_direction) * kq * rpm_sq

	# Electrical power consumption: P = P_idle + c * |RPM|^3
	if is_failed:
		current_power_watts = 0.0
	else:
		current_power_watts = idle_power_watts + power_coeff * pow(abs(current_rpm), 3.0)

	# ESC thermal model
	var ambient_temp: float = 15.0
	var heat_gen: float = current_power_watts * 0.08
	var heat_diss: float = (esc_temperature_c - ambient_temp) * 0.05
	esc_temperature_c = clamp(esc_temperature_c + (heat_gen - heat_diss) * delta, ambient_temp, 95.0)

	# Update thrust arrow visual scale
	if _thrust_arrow != null:
		var arrow_scale: float = clamp(abs(current_thrust_n) * 0.12, 0.01, 1.2)
		_thrust_arrow.scale = Vector3(1.0, 1.0, arrow_scale)
		_thrust_arrow.visible = abs(current_thrust_n) > 0.1

	# Emit telemetry packet
	var t_data: Dictionary = {
		"id": motor_id,
		"name": motor_name,
		"rpm": current_rpm,
		"commanded_rpm": commanded_rpm,
		"throttle_pct": (abs(current_rpm) / max_rpm) * 100.0,
		"thrust_n": current_thrust_n,
		"torque_nm": current_reaction_torque_nm,
		"power_w": current_power_watts,
		"temp_c": esc_temperature_c,
		"is_healthy": not is_failed
	}
	telemetry_updated.emit(t_data)

## Sets throttle input from -1.0 to +1.0 (or 0.0 to 1.0).
func set_throttle(throttle: float) -> void:
	if is_failed:
		commanded_rpm = 0.0
		return
	commanded_rpm = clamp(throttle, -1.0, 1.0) * max_rpm

## Injects hardware failure / cutoff for testing Scenario 8.
func inject_fault(fail: bool) -> void:
	is_failed = fail
	if is_failed:
		commanded_rpm = 0.0
		current_rpm = 0.0
		current_thrust_n = 0.0
		current_reaction_torque_nm = 0.0
		if _label_badge != null:
			_label_badge.text = "%s [FAULT]" % motor_name
			_label_badge.modulate = Color(1.0, 0.2, 0.2)
	else:
		if _label_badge != null:
			_label_badge.text = "%s [%s]" % [motor_name, "CW" if spin_direction > 0 else "CCW"]
			_label_badge.modulate = Color(0.3, 0.85, 0.4)

## Returns world-space thrust vector force (Newtons).
func get_world_thrust_vector() -> Vector3:
	var local_vec: Vector3 = thrust_direction_local * current_thrust_n
	return global_transform.basis * local_vec

## Returns local thrust vector relative to lower frame.
func get_frame_thrust_vector() -> Vector3:
	return thrust_direction_local * current_thrust_n

## Procedurally constructs realistic 3D mesh oriented along the thrust axis:
## stator, rotor can, hub, high-visibility 3-blade propeller with safety tips, mount, and ESC.
func _build_motor_geometry() -> void:
	# Motor pod container oriented along thrust direction
	var pod_node: Node3D = Node3D.new()
	pod_node.name = "PodOriented"
	if thrust_direction_local.length_squared() > 0.001:
		var t_dir: Vector3 = thrust_direction_local.normalized()
		var up_v: Vector3 = Vector3.UP if abs(t_dir.dot(Vector3.UP)) < 0.95 else Vector3.FORWARD
		pod_node.transform = Transform3D().looking_at(t_dir, up_v)
	add_child(pod_node)

	# 1. CNC Aluminum Arm Mounting Bracket
	var mount_mat: StandardMaterial3D = StandardMaterial3D.new()
	mount_mat.albedo_color = Color(0.75, 0.78, 0.82) # Billet silver aluminum
	mount_mat.metallic = 0.92
	mount_mat.roughness = 0.22

	var mount_base: MeshInstance3D = MeshInstance3D.new()
	var mb_mesh: BoxMesh = BoxMesh.new()
	mb_mesh.size = Vector3(0.07, 0.06, 0.04)
	mount_base.mesh = mb_mesh
	mount_base.material_override = mount_mat
	mount_base.position = Vector3(0.0, -0.035, -0.02)
	pod_node.add_child(mount_base)

	# 2. Heavy-duty Outrunner BLDC Motor (Stator base & Rotor Can)
	var stator_mat: StandardMaterial3D = StandardMaterial3D.new()
	stator_mat.albedo_color = Color(0.85, 0.45, 0.18) # Copper winding ring
	stator_mat.metallic = 0.95
	stator_mat.roughness = 0.25

	var stator_mesh: CylinderMesh = CylinderMesh.new()
	stator_mesh.top_radius = 0.028
	stator_mesh.bottom_radius = 0.028
	stator_mesh.height = 0.018
	var stator_inst: MeshInstance3D = MeshInstance3D.new()
	stator_inst.mesh = stator_mesh
	stator_inst.material_override = stator_mat
	stator_inst.rotation_degrees = Vector3(90.0, 0.0, 0.0) # Cylinder along Z
	stator_inst.position = Vector3(0.0, 0.0, -0.015)
	pod_node.add_child(stator_inst)

	# Rotor Bell / Can (Machined dark gunmetal alloy)
	var rotor_mat: StandardMaterial3D = StandardMaterial3D.new()
	rotor_mat.albedo_color = Color(0.24, 0.26, 0.30)
	rotor_mat.metallic = 0.90
	rotor_mat.roughness = 0.28

	var rotor_mesh: CylinderMesh = CylinderMesh.new()
	rotor_mesh.top_radius = 0.032
	rotor_mesh.bottom_radius = 0.032
	rotor_mesh.height = 0.036
	var rotor_inst: MeshInstance3D = MeshInstance3D.new()
	rotor_inst.mesh = rotor_mesh
	rotor_inst.material_override = rotor_mat
	rotor_inst.rotation_degrees = Vector3(90.0, 0.0, 0.0)
	rotor_inst.position = Vector3(0.0, 0.0, 0.012)
	pod_node.add_child(rotor_inst)

	# Steel Motor Shaft (Brushed stainless steel)
	var shaft_mat: StandardMaterial3D = StandardMaterial3D.new()
	shaft_mat.albedo_color = Color(0.85, 0.86, 0.90)
	shaft_mat.metallic = 0.85
	shaft_mat.roughness = 0.30
	var shaft_mesh: CylinderMesh = CylinderMesh.new()
	shaft_mesh.top_radius = 0.004
	shaft_mesh.bottom_radius = 0.004
	shaft_mesh.height = 0.05
	var shaft_inst: MeshInstance3D = MeshInstance3D.new()
	shaft_inst.mesh = shaft_mesh
	shaft_inst.material_override = shaft_mat
	shaft_inst.rotation_degrees = Vector3(90.0, 0.0, 0.0)
	shaft_inst.position = Vector3(0.0, 0.0, 0.04)
	pod_node.add_child(shaft_inst)

	# 3. Propeller Assembly (Rotates around local Z thrust axis)
	prop_rotator_node = Node3D.new()
	prop_rotator_node.name = "PropellerRotator"
	prop_rotator_node.position = Vector3(0.0, 0.0, 0.035)
	pod_node.add_child(prop_rotator_node)

	# Propeller Bullet Spinner Nut (Red for CCW, Blue/Silver for CW)
	var nut_mat: StandardMaterial3D = StandardMaterial3D.new()
	nut_mat.albedo_color = Color(0.9, 0.2, 0.2) if spin_direction < 0 else Color(0.2, 0.5, 0.9)
	nut_mat.metallic = 0.85
	nut_mat.roughness = 0.20

	var nut_mesh: CylinderMesh = CylinderMesh.new()
	nut_mesh.top_radius = 0.004
	nut_mesh.bottom_radius = 0.014
	nut_mesh.height = 0.026
	var nut_inst: MeshInstance3D = MeshInstance3D.new()
	nut_inst.mesh = nut_mesh
	nut_inst.material_override = nut_mat
	nut_inst.rotation_degrees = Vector3(90.0, 0.0, 0.0)
	nut_inst.position = Vector3(0.0, 0.0, 0.015)
	prop_rotator_node.add_child(nut_inst)

	# 3-Blade Propeller (14-inch diameter / 0.18m radius)
	var prop_mat: StandardMaterial3D = StandardMaterial3D.new()
	prop_mat.albedo_color = Color(0.18, 0.18, 0.20) # Carbon fiber blade
	prop_mat.metallic = 0.2
	prop_mat.roughness = 0.35

	# High-visibility warning tip material (Safety yellow / white)
	var tip_mat: StandardMaterial3D = StandardMaterial3D.new()
	tip_mat.albedo_color = Color(0.98, 0.85, 0.15) # Safety yellow tips
	tip_mat.roughness = 0.3

	for b in range(3):
		var blade_angle: float = float(b) * (2.0 * PI / 3.0)
		var blade_holder: Node3D = Node3D.new()
		blade_holder.rotation.z = blade_angle
		prop_rotator_node.add_child(blade_holder)

		# Main blade body
		var blade_mesh: BoxMesh = BoxMesh.new()
		blade_mesh.size = Vector3(0.024, 0.14, 0.005)

		var blade_inst: MeshInstance3D = MeshInstance3D.new()
		blade_inst.mesh = blade_mesh
		blade_inst.material_override = prop_mat
		blade_inst.rotation_degrees = Vector3(0.0, 0.0, 14.0 * float(spin_direction))
		blade_inst.position = Vector3(0.0, 0.08, 0.0)
		blade_holder.add_child(blade_inst)

		# Safety yellow tip segment
		var tip_mesh: BoxMesh = BoxMesh.new()
		tip_mesh.size = Vector3(0.022, 0.035, 0.004)
		var tip_inst: MeshInstance3D = MeshInstance3D.new()
		tip_inst.mesh = tip_mesh
		tip_inst.material_override = tip_mat
		tip_inst.position = Vector3(0.0, 0.165, 0.0)
		blade_holder.add_child(tip_inst)

	# 4. Protective Ducted Fan Cowl & Anti-Tear Safety Enclosure
	# Completely encloses spinning propeller blades to prevent any contact with balloon envelope film
	var duct_node: Node3D = Node3D.new()
	duct_node.name = "SafetyDuctEnclosure"
	pod_node.add_child(duct_node)

	var duct_mat: StandardMaterial3D = StandardMaterial3D.new()
	duct_mat.albedo_color = Color(0.94, 0.45, 0.12) # High-visibility aerospace safety orange
	duct_mat.roughness = 0.35
	duct_mat.metallic = 0.20

	var carbon_liner_mat: StandardMaterial3D = StandardMaterial3D.new()
	carbon_liner_mat.albedo_color = Color(0.20, 0.22, 0.26) # Structural carbon composite
	carbon_liner_mat.roughness = 0.30
	carbon_liner_mat.metallic = 0.70

	# A. Front aerodynamic bullnose lip (smooth rounded rim prevents film snag/tear)
	var front_lip_mesh: TorusMesh = TorusMesh.new()
	front_lip_mesh.inner_radius = 0.192
	front_lip_mesh.outer_radius = 0.210
	var front_lip: MeshInstance3D = MeshInstance3D.new()
	front_lip.mesh = front_lip_mesh
	front_lip.material_override = duct_mat
	front_lip.rotation_degrees = Vector3(90.0, 0.0, 0.0)
	front_lip.position = Vector3(0.0, 0.0, 0.075)
	duct_node.add_child(front_lip)

	# B. Rear aerodynamic exhaust lip
	var rear_lip_mesh: TorusMesh = TorusMesh.new()
	rear_lip_mesh.inner_radius = 0.192
	rear_lip_mesh.outer_radius = 0.210
	var rear_lip: MeshInstance3D = MeshInstance3D.new()
	rear_lip.mesh = rear_lip_mesh
	rear_lip.material_override = carbon_liner_mat
	rear_lip.rotation_degrees = Vector3(90.0, 0.0, 0.0)
	rear_lip.position = Vector3(0.0, 0.0, -0.015)
	duct_node.add_child(rear_lip)

	# C. Outer protective duct shroud shell
	var duct_outer_mesh: CylinderMesh = CylinderMesh.new()
	duct_outer_mesh.top_radius = 0.208
	duct_outer_mesh.bottom_radius = 0.208
	duct_outer_mesh.height = 0.090
	var duct_outer: MeshInstance3D = MeshInstance3D.new()
	duct_outer.mesh = duct_outer_mesh
	duct_outer.material_override = duct_mat
	duct_outer.rotation_degrees = Vector3(90.0, 0.0, 0.0)
	duct_outer.position = Vector3(0.0, 0.0, 0.030)
	duct_node.add_child(duct_outer)

	# D. 4 Radial Anti-Tear Structural Guard Struts (connects hub to duct perimeter)
	for s in range(4):
		var strut_angle: float = float(s) * (PI * 0.5) + deg_to_rad(45.0)
		var strut_mesh: BoxMesh = BoxMesh.new()
		strut_mesh.size = Vector3(0.012, 0.190, 0.008)
		var strut_inst: MeshInstance3D = MeshInstance3D.new()
		strut_inst.mesh = strut_mesh
		strut_inst.material_override = carbon_liner_mat
		strut_inst.rotation.z = strut_angle
		strut_inst.position = Vector3(sin(strut_angle) * 0.095, cos(strut_angle) * 0.095, -0.008)
		duct_node.add_child(strut_inst)

	# E. Concentric front safety guard ring (prevents loose film intrusion into disc)
	var guard_ring_mesh: TorusMesh = TorusMesh.new()
	guard_ring_mesh.inner_radius = 0.118
	guard_ring_mesh.outer_radius = 0.124
	var guard_ring: MeshInstance3D = MeshInstance3D.new()
	guard_ring.mesh = guard_ring_mesh
	guard_ring.material_override = duct_mat
	guard_ring.rotation_degrees = Vector3(90.0, 0.0, 0.0)
	guard_ring.position = Vector3(0.0, 0.0, 0.075)
	duct_node.add_child(guard_ring)

	# 5. Dedicated Electronic Speed Controller (ESC) Module
	var esc_mat: StandardMaterial3D = StandardMaterial3D.new()
	esc_mat.albedo_color = Color(0.10, 0.35, 0.65) # Blue heatshrink with heatsink
	esc_mat.roughness = 0.4
	var esc_mesh: BoxMesh = BoxMesh.new()
	esc_mesh.size = Vector3(0.045, 0.016, 0.075)
	var esc_inst: MeshInstance3D = MeshInstance3D.new()
	esc_inst.mesh = esc_mesh
	esc_inst.material_override = esc_mat
	esc_inst.position = Vector3(0.0, -0.065, -0.03)
	pod_node.add_child(esc_inst)

	# 5. Motor Identification Label3D Badge (M1, M2, M3, M4)
	_label_badge = Label3D.new()
	_label_badge.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	_label_badge.font_size = 14
	_label_badge.pixel_size = 0.0022
	_label_badge.outline_size = 3
	_label_badge.modulate = Color(0.35, 0.95, 0.45)
	_label_badge.outline_modulate = Color(0.05, 0.08, 0.12, 0.95)
	_label_badge.text = "%s [%s]" % [motor_name, "CW" if spin_direction > 0 else "CCW"]
	_label_badge.position = Vector3(0.0, 0.25, 0.0)
	pod_node.add_child(_label_badge)

	# 6. Dynamic Thrust Vector Arrow (Emissive cyan cone)
	var arrow_mat: StandardMaterial3D = StandardMaterial3D.new()
	arrow_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	arrow_mat.albedo_color = Color(0.2, 0.9, 1.0, 0.85)

	var arrow_mesh: CylinderMesh = CylinderMesh.new()
	arrow_mesh.top_radius = 0.001
	arrow_mesh.bottom_radius = 0.022
	arrow_mesh.height = 0.25

	_thrust_arrow = MeshInstance3D.new()
	_thrust_arrow.mesh = arrow_mesh
	_thrust_arrow.material_override = arrow_mat
	_thrust_arrow.rotation_degrees = Vector3(-90.0, 0.0, 0.0) # Point along Z thrust
	_thrust_arrow.position = Vector3(0.0, 0.0, 0.20)
	_thrust_arrow.visible = false
	pod_node.add_child(_thrust_arrow)
