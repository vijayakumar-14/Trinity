class_name PayloadView
extends Node3D

## Procedurally constructs a modular scientific electronics payload assembly.
## Contains distinct 3D meshes for Edge-AI TPU, PCB, GNSS, IMU, Baro, LoRa, Battery, and Nadir camera.

@export var show_labels: bool = true

var _labels: Array[Label3D] = []
var _attach_points: Array[Node3D] = []

func _ready() -> void:
	_build_structural_frame()
	_build_edge_ai_module()
	_build_flight_controller_pcb()
	_build_gnss_subsystem()
	_build_imu_module()
	_build_baro_temp_sensor()
	_build_telemetry_radio()
	_build_battery_pack()
	_build_nadir_camera()
	_build_corner_attach_points()

func _create_material(color: Color, roughness: float = 0.5, metallic: float = 0.1) -> StandardMaterial3D:
	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = roughness
	mat.metallic = metallic
	return mat

## 1. Structural aluminum 2020 extrusion frame & carbon fiber plates
func _build_structural_frame() -> void:
	var frame_mat: StandardMaterial3D = _create_material(Color(0.85, 0.88, 0.92), 0.22, 0.95) # Silver aviation aluminum 2020
	var plate_mat: StandardMaterial3D = _create_material(Color(0.20, 0.22, 0.25), 0.35, 0.35) # High-grade twill carbon fiber

	# Base plate (bottom deck)
	var base_mesh: BoxMesh = BoxMesh.new()
	base_mesh.size = Vector3(0.44, 0.010, 0.38)
	var base_inst: MeshInstance3D = MeshInstance3D.new()
	base_inst.mesh = base_mesh
	base_inst.material_override = plate_mat
	base_inst.position = Vector3(0.0, -0.16, 0.0)
	add_child(base_inst)

	# Top deck
	var top_mesh: BoxMesh = BoxMesh.new()
	top_mesh.size = Vector3(0.44, 0.010, 0.38)
	var top_inst: MeshInstance3D = MeshInstance3D.new()
	top_inst.mesh = top_mesh
	top_inst.material_override = plate_mat
	top_inst.position = Vector3(0.0, 0.16, 0.0)
	add_child(top_inst)

	# 4 Corner vertical aluminum extrusion posts
	var post_positions: Array[Vector3] = [
		Vector3(0.20, 0.0, 0.17),
		Vector3(-0.20, 0.0, 0.17),
		Vector3(-0.20, 0.0, -0.17),
		Vector3(0.20, 0.0, -0.17)
	]
	for p in post_positions:
		var post_mesh: BoxMesh = BoxMesh.new()
		post_mesh.size = Vector3(0.024, 0.32, 0.024)
		var post_inst: MeshInstance3D = MeshInstance3D.new()
		post_inst.mesh = post_mesh
		post_inst.material_override = frame_mat
		post_inst.position = p
		add_child(post_inst)

## 2. Central Edge-AI compute module (Heatsink with cooling fins and LEDs)
func _build_edge_ai_module() -> void:
	var module_node: Node3D = Node3D.new()
	module_node.position = Vector3(-0.06, 0.02, 0.0)
	add_child(module_node)

	# Aluminum enclosure block
	var heatsink_mat: StandardMaterial3D = _create_material(Color(0.18, 0.19, 0.22), 0.3, 0.8)
	var fin_mesh: BoxMesh = BoxMesh.new()
	fin_mesh.size = Vector3(0.14, 0.04, 0.12)
	var fin_inst: MeshInstance3D = MeshInstance3D.new()
	fin_inst.mesh = fin_mesh
	fin_inst.material_override = heatsink_mat
	module_node.add_child(fin_inst)

	# 8 Extruded cooling fins
	var fin_plate_mesh: BoxMesh = BoxMesh.new()
	fin_plate_mesh.size = Vector3(0.13, 0.02, 0.004)
	for i in range(8):
		var fin_p: MeshInstance3D = MeshInstance3D.new()
		fin_p.mesh = fin_plate_mesh
		fin_p.material_override = heatsink_mat
		fin_p.position = Vector3(0.0, 0.03, -0.045 + float(i) * 0.013)
		module_node.add_child(fin_p)

	# Status LED indicator (pulsing cyan inference LED)
	var led_mesh: SphereMesh = SphereMesh.new()
	led_mesh.radius = 0.006
	led_mesh.height = 0.012
	var led_mat: StandardMaterial3D = StandardMaterial3D.new()
	led_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	led_mat.albedo_color = Color(0.1, 0.9, 0.8)
	var led_inst: MeshInstance3D = MeshInstance3D.new()
	led_inst.mesh = led_mesh
	led_inst.material_override = led_mat
	led_inst.position = Vector3(0.05, 0.025, 0.045)
	module_node.add_child(led_inst)

	_add_tech_label(module_node, Vector3(0.0, 0.06, 0.0), "EDGE-AI COMPUTE (Coral TPU / Orin)")

## 3. Flight Controller PCB (Dark-green substrate, IC chips, connectors)
func _build_flight_controller_pcb() -> void:
	var pcb_node: Node3D = Node3D.new()
	pcb_node.position = Vector3(0.10, -0.06, 0.0)
	add_child(pcb_node)

	# Dark green FR4 substrate
	var pcb_mat: StandardMaterial3D = _create_material(Color(0.05, 0.28, 0.12), 0.4, 0.05)
	var pcb_mesh: BoxMesh = BoxMesh.new()
	pcb_mesh.size = Vector3(0.16, 0.004, 0.14)
	var pcb_inst: MeshInstance3D = MeshInstance3D.new()
	pcb_inst.mesh = pcb_mesh
	pcb_inst.material_override = pcb_mat
	pcb_node.add_child(pcb_inst)

	# Central MCU chip (STM32 QFP package)
	var ic_mat: StandardMaterial3D = _create_material(Color(0.1, 0.1, 0.1), 0.2, 0.1)
	var ic_mesh: BoxMesh = BoxMesh.new()
	ic_mesh.size = Vector3(0.035, 0.006, 0.035)
	var ic_inst: MeshInstance3D = MeshInstance3D.new()
	ic_inst.mesh = ic_mesh
	ic_inst.material_override = ic_mat
	ic_inst.position = Vector3(0.0, 0.005, 0.0)
	pcb_node.add_child(ic_inst)

	# Gold/metallic corner mounting standoffs
	var standoff_mat: StandardMaterial3D = _create_material(Color(0.85, 0.75, 0.25), 0.3, 0.9)
	var so_mesh: CylinderMesh = CylinderMesh.new()
	so_mesh.top_radius = 0.005
	so_mesh.bottom_radius = 0.005
	so_mesh.height = 0.02
	var so_positions: Array[Vector3] = [
		Vector3(0.07, -0.01, 0.06),
		Vector3(-0.07, -0.01, 0.06),
		Vector3(-0.07, -0.01, -0.06),
		Vector3(0.07, -0.01, -0.06)
	]
	for p in so_positions:
		var so_inst: MeshInstance3D = MeshInstance3D.new()
		so_inst.mesh = so_mesh
		so_inst.material_override = standoff_mat
		so_inst.position = p
		pcb_node.add_child(so_inst)

	# Micro-connectors (JST / USB)
	var conn_mat: StandardMaterial3D = _create_material(Color(0.9, 0.9, 0.9), 0.3, 0.2)
	var conn_mesh: BoxMesh = BoxMesh.new()
	conn_mesh.size = Vector3(0.018, 0.008, 0.012)
	var conn_inst: MeshInstance3D = MeshInstance3D.new()
	conn_inst.mesh = conn_mesh
	conn_inst.material_override = conn_mat
	conn_inst.position = Vector3(0.065, 0.006, 0.0)
	pcb_node.add_child(conn_inst)

	_add_tech_label(pcb_node, Vector3(0.0, 0.04, 0.0), "FLIGHT CONTROLLER (STM32H7)")

## 4. GNSS Patch Antenna & Receiver
func _build_gnss_subsystem() -> void:
	var gnss_node: Node3D = Node3D.new()
	gnss_node.position = Vector3(0.12, 0.17, 0.10)
	add_child(gnss_node)

	# Ceramic patch antenna (tan/beige ceramic with silver center dot)
	var patch_mat: StandardMaterial3D = _create_material(Color(0.82, 0.76, 0.65), 0.6, 0.0)
	var patch_mesh: BoxMesh = BoxMesh.new()
	patch_mesh.size = Vector3(0.055, 0.012, 0.055)
	var patch_inst: MeshInstance3D = MeshInstance3D.new()
	patch_inst.mesh = patch_mesh
	patch_inst.material_override = patch_mat
	gnss_node.add_child(patch_inst)

	# Metal center pin
	var pin_mat: StandardMaterial3D = _create_material(Color(0.9, 0.9, 0.95), 0.2, 0.9)
	var pin_mesh: CylinderMesh = CylinderMesh.new()
	pin_mesh.top_radius = 0.004
	pin_mesh.bottom_radius = 0.004
	pin_mesh.height = 0.014
	var pin_inst: MeshInstance3D = MeshInstance3D.new()
	pin_inst.mesh = pin_mesh
	pin_inst.material_override = pin_mat
	pin_inst.position = Vector3(0.0, 0.002, 0.0)
	gnss_node.add_child(pin_inst)

	_add_tech_label(gnss_node, Vector3(0.0, 0.04, 0.0), "GNSS L1/L5 PATCH ANTENNA")

## 5. IMU 9-DOF Sensor Module
func _build_imu_module() -> void:
	var imu_node: Node3D = Node3D.new()
	imu_node.position = Vector3(0.08, -0.05, -0.04)
	add_child(imu_node)

	var imu_mesh: BoxMesh = BoxMesh.new()
	imu_mesh.size = Vector3(0.024, 0.004, 0.024)
	var imu_mat: StandardMaterial3D = _create_material(Color(0.12, 0.25, 0.65), 0.3, 0.1) # Blue breakout board
	var imu_inst: MeshInstance3D = MeshInstance3D.new()
	imu_inst.mesh = imu_mesh
	imu_inst.material_override = imu_mat
	imu_node.add_child(imu_inst)

	_add_tech_label(imu_node, Vector3(0.0, 0.03, 0.0), "IMU 9-DOF (ACCEL/GYRO)")

## 6. Barometric Pressure & Temperature Sensor
func _build_baro_temp_sensor() -> void:
	var baro_node: Node3D = Node3D.new()
	baro_node.position = Vector3(0.14, -0.05, 0.04)
	add_child(baro_node)

	# Metallic transducer can (Bosch BMP style)
	var baro_mat: StandardMaterial3D = _create_material(Color(0.85, 0.88, 0.92), 0.15, 0.95)
	var baro_mesh: CylinderMesh = CylinderMesh.new()
	baro_mesh.top_radius = 0.007
	baro_mesh.bottom_radius = 0.007
	baro_mesh.height = 0.008
	var baro_inst: MeshInstance3D = MeshInstance3D.new()
	baro_inst.mesh = baro_mesh
	baro_inst.material_override = baro_mat
	baro_node.add_child(baro_inst)

	# Pitot static pressure probe tube extending forward
	var probe_mesh: CylinderMesh = CylinderMesh.new()
	probe_mesh.top_radius = 0.003
	probe_mesh.bottom_radius = 0.003
	probe_mesh.height = 0.08
	var probe_inst: MeshInstance3D = MeshInstance3D.new()
	probe_inst.mesh = probe_mesh
	probe_inst.material_override = baro_mat
	probe_inst.rotation_degrees = Vector3(90.0, 0.0, 0.0)
	probe_inst.position = Vector3(0.05, 0.0, 0.0)
	baro_node.add_child(probe_inst)

	_add_tech_label(baro_node, Vector3(0.0, 0.03, 0.0), "BARO / TEMP SENSOR")

## 7. Radio Telemetry Module & Downward Whip Antenna
func _build_telemetry_radio() -> void:
	var radio_node: Node3D = Node3D.new()
	radio_node.position = Vector3(-0.16, -0.06, -0.10)
	add_child(radio_node)

	# RF metal shield can
	var rf_mat: StandardMaterial3D = _create_material(Color(0.82, 0.84, 0.86), 0.2, 0.9)
	var rf_mesh: BoxMesh = BoxMesh.new()
	rf_mesh.size = Vector3(0.035, 0.008, 0.045)
	var rf_inst: MeshInstance3D = MeshInstance3D.new()
	rf_inst.mesh = rf_mesh
	rf_inst.material_override = rf_mat
	radio_node.add_child(rf_inst)

	# Gold SMA connector
	var sma_mat: StandardMaterial3D = _create_material(Color(0.88, 0.72, 0.18), 0.2, 0.95)
	var sma_mesh: CylinderMesh = CylinderMesh.new()
	sma_mesh.top_radius = 0.005
	sma_mesh.bottom_radius = 0.005
	sma_mesh.height = 0.016
	var sma_inst: MeshInstance3D = MeshInstance3D.new()
	sma_inst.mesh = sma_mesh
	sma_inst.material_override = sma_mat
	sma_inst.position = Vector3(0.0, -0.01, -0.02)
	radio_node.add_child(sma_inst)

	# Downward-pointing whip antenna
	var whip_mat: StandardMaterial3D = _create_material(Color(0.15, 0.15, 0.15), 0.4, 0.6)
	var whip_mesh: CylinderMesh = CylinderMesh.new()
	whip_mesh.top_radius = 0.002
	whip_mesh.bottom_radius = 0.002
	whip_mesh.height = 0.32
	var whip_inst: MeshInstance3D = MeshInstance3D.new()
	whip_inst.mesh = whip_mesh
	whip_inst.material_override = whip_mat
	whip_inst.position = Vector3(0.0, -0.18, -0.02)
	radio_node.add_child(whip_inst)

	_add_tech_label(radio_node, Vector3(0.0, 0.04, 0.0), "LORA TELEMETRY 868MHz")

## 8. Battery Pack (4S2P LiPo with retention strap and wiring)
func _build_battery_pack() -> void:
	var batt_node: Node3D = Node3D.new()
	batt_node.position = Vector3(-0.06, -0.08, 0.0)
	add_child(batt_node)

	# Yellow heatshrink casing
	var batt_mat: StandardMaterial3D = _create_material(Color(0.88, 0.75, 0.12), 0.5, 0.1)
	var batt_mesh: BoxMesh = BoxMesh.new()
	batt_mesh.size = Vector3(0.15, 0.065, 0.09)
	var batt_inst: MeshInstance3D = MeshInstance3D.new()
	batt_inst.mesh = batt_mesh
	batt_inst.material_override = batt_mat
	batt_node.add_child(batt_inst)

	# Black Velcro retention strap
	var strap_mat: StandardMaterial3D = _create_material(Color(0.08, 0.08, 0.08), 0.9, 0.0)
	var strap_mesh: BoxMesh = BoxMesh.new()
	strap_mesh.size = Vector3(0.03, 0.07, 0.094)
	var strap_inst: MeshInstance3D = MeshInstance3D.new()
	strap_inst.mesh = strap_mesh
	strap_inst.material_override = strap_mat
	batt_node.add_child(strap_inst)

	_add_tech_label(batt_node, Vector3(0.0, 0.05, 0.0), "LiPo 4S2P BATTERY PACK (240Wh)")

## 9. Nadir Optical Vision Sensor / Camera
func _build_nadir_camera() -> void:
	var cam_node: Node3D = Node3D.new()
	cam_node.position = Vector3(0.0, -0.175, 0.0)
	add_child(cam_node)

	# Cylindrical lens barrel
	var barrel_mat: StandardMaterial3D = _create_material(Color(0.12, 0.12, 0.14), 0.2, 0.8)
	var barrel_mesh: CylinderMesh = CylinderMesh.new()
	barrel_mesh.top_radius = 0.018
	barrel_mesh.bottom_radius = 0.018
	barrel_mesh.height = 0.024
	var barrel_inst: MeshInstance3D = MeshInstance3D.new()
	barrel_inst.mesh = barrel_mesh
	barrel_inst.material_override = barrel_mat
	cam_node.add_child(barrel_inst)

	# Blue optical glass element
	var glass_mat: StandardMaterial3D = _create_material(Color(0.08, 0.22, 0.55), 0.05, 0.3)
	glass_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glass_mat.albedo_color.a = 0.85
	var glass_mesh: CylinderMesh = CylinderMesh.new()
	glass_mesh.top_radius = 0.014
	glass_mesh.bottom_radius = 0.014
	glass_mesh.height = 0.005
	var glass_inst: MeshInstance3D = MeshInstance3D.new()
	glass_inst.mesh = glass_mesh
	glass_inst.material_override = glass_mat
	glass_inst.position = Vector3(0.0, -0.013, 0.0)
	cam_node.add_child(glass_inst)

	_add_tech_label(cam_node, Vector3(0.0, -0.04, 0.0), "NADIR OPTICAL SENSOR")

## 10. Corner harness attachment eye-bolts
func _build_corner_attach_points() -> void:
	var corners: Array[Vector3] = [
		Vector3(0.20, 0.17, 0.17),
		Vector3(-0.20, 0.17, 0.17),
		Vector3(-0.20, 0.17, -0.17),
		Vector3(0.20, 0.17, -0.17)
	]
	var bolt_mat: StandardMaterial3D = _create_material(Color(0.85, 0.85, 0.88), 0.2, 0.9)
	for i in range(corners.size()):
		var p: Vector3 = corners[i]
		var eye_mesh: TorusMesh = TorusMesh.new()
		eye_mesh.inner_radius = 0.008
		eye_mesh.outer_radius = 0.014
		var eye_inst: MeshInstance3D = MeshInstance3D.new()
		eye_inst.mesh = eye_mesh
		eye_inst.material_override = bolt_mat
		eye_inst.position = p
		eye_inst.rotation_degrees = Vector3(0.0, 45.0, 90.0)
		add_child(eye_inst)
		_attach_points.append(eye_inst)

func _add_tech_label(parent: Node3D, pos: Vector3, text: String) -> void:
	var label: Label3D = Label3D.new()
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.font_size = 11
	label.pixel_size = 0.0011
	label.outline_size = 2
	label.modulate = Color(0.85, 0.92, 0.98, 0.85)
	label.outline_modulate = Color(0.05, 0.08, 0.12, 0.95)
	label.text = text
	label.position = pos
	label.visibility_range_end = 4.2
	label.visible = show_labels
	parent.add_child(label)
	_labels.append(label)

func set_labels_visible(visible_state: bool) -> void:
	show_labels = visible_state
	for l in _labels:
		if l != null:
			l.visible = visible_state

func get_harness_anchors() -> Array[Vector3]:
	var anchors: Array[Vector3] = []
	for node in _attach_points:
		if node != null:
			anchors.append(node.global_position)
	return anchors
