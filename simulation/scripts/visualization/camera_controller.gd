class_name CameraController
extends Node3D

## Multi-mode camera rig supporting Orbit, Follow Chase, Motor Frame Inspection,
## Tactical Map Overview, and Top-Down Motor Layout camera modes.

enum CameraMode {
	ORBIT = 0,
	FOLLOW = 1,
	INSPECT_MOTORS = 2,
	TACTICAL_OVERVIEW = 3,
	TOP_DOWN_LAYOUT = 4
}

@export var current_mode: CameraMode = CameraMode.ORBIT
@export var target_node: Node3D # BalloonPhysics or BalloonAssembly
@export var payload_node: Node3D # MotorFrame or PayloadView

var camera: Camera3D

# Orbit parameters calibrated to frame 52% of viewport height
var orbit_yaw: float = -38.0
var orbit_pitch: float = 16.0
var orbit_distance: float = 11.2

# Follow parameters
var follow_distance: float = 18.0
var follow_height: float = 4.0

# Mouse control state
var _is_mouse_dragging: bool = false
var _last_mouse_pos: Vector2 = Vector2.ZERO

func _ready() -> void:
	camera = Camera3D.new()
	camera.name = "SimCamera"
	camera.current = true
	camera.far = 16000.0
	camera.near = 0.1
	camera.fov = 52.0
	add_child(camera)
	reset_camera()
	snap_to_target()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb: InputEventMouseButton = event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_RIGHT:
			_is_mouse_dragging = mb.pressed
			_last_mouse_pos = mb.position
		elif mb.button_index == MOUSE_BUTTON_WHEEL_UP:
			_adjust_zoom(-0.8)
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_adjust_zoom(0.8)

	elif event is InputEventMouseMotion and _is_mouse_dragging:
		var mm: InputEventMouseMotion = event as InputEventMouseMotion
		var delta: Vector2 = mm.relative
		orbit_yaw -= delta.x * 0.3
		orbit_pitch = clamp(orbit_pitch - delta.y * 0.3, -80.0, 85.0)

	elif event is InputEventKey and event.pressed:
		var key: InputEventKey = event as InputEventKey
		if key.keycode == KEY_1:
			set_mode(CameraMode.ORBIT)
		elif key.keycode == KEY_2:
			set_mode(CameraMode.FOLLOW)
		elif key.keycode == KEY_3:
			set_mode(CameraMode.INSPECT_MOTORS)
		elif key.keycode == KEY_4:
			set_mode(CameraMode.TACTICAL_OVERVIEW)
		elif key.keycode == KEY_5:
			set_mode(CameraMode.TOP_DOWN_LAYOUT)
		elif key.keycode == KEY_R:
			reset_camera()

func _adjust_zoom(delta: float) -> void:
	match current_mode:
		CameraMode.ORBIT:
			orbit_distance = clamp(orbit_distance + delta, 4.0, 60.0)
		CameraMode.FOLLOW:
			follow_distance = clamp(follow_distance + delta * 1.5, 8.0, 100.0)
		CameraMode.INSPECT_MOTORS:
			orbit_distance = clamp(orbit_distance + delta * 0.3, 1.2, 8.0)
		CameraMode.TACTICAL_OVERVIEW:
			orbit_distance = clamp(orbit_distance + delta * 15.0, 100.0, 2500.0)
		CameraMode.TOP_DOWN_LAYOUT:
			orbit_distance = clamp(orbit_distance + delta * 0.4, 1.8, 10.0)

func reset_camera() -> void:
	current_mode = CameraMode.ORBIT
	orbit_yaw = -38.0
	orbit_pitch = 16.0
	orbit_distance = 9.2
	snap_to_target()

func snap_to_target() -> void:
	if target_node == null or camera == null:
		return
	# Balloon top is at +2.5m, lower frame is at -2.95m -> vertical midpoint is -0.30m
	var assembly_center: Vector3 = target_node.global_position + Vector3(0.0, -0.30, 0.0)
	match current_mode:
		CameraMode.ORBIT:
			var rad_yaw: float = deg_to_rad(orbit_yaw)
			var rad_pitch: float = deg_to_rad(orbit_pitch)
			var offset: Vector3 = Vector3(
				sin(rad_yaw) * cos(rad_pitch),
				sin(rad_pitch),
				cos(rad_yaw) * cos(rad_pitch)
			) * orbit_distance
			camera.global_position = assembly_center + offset
			camera.look_at(assembly_center, Vector3.UP)
		CameraMode.INSPECT_MOTORS:
			var motor_focus: Vector3 = target_node.global_position + Vector3(0.0, -2.95, 0.0)
			if payload_node != null and payload_node.is_inside_tree():
				motor_focus = payload_node.global_position
			var rad_yaw: float = deg_to_rad(orbit_yaw)
			var rad_pitch: float = deg_to_rad(orbit_pitch)
			var offset: Vector3 = Vector3(
				sin(rad_yaw) * cos(rad_pitch),
				sin(rad_pitch),
				cos(rad_yaw) * cos(rad_pitch)
			) * orbit_distance
			camera.global_position = motor_focus + offset
			camera.look_at(motor_focus, Vector3.UP)
		CameraMode.TOP_DOWN_LAYOUT:
			var top_focus: Vector3 = target_node.global_position + Vector3(0.0, -2.95, 0.0)
			if payload_node != null and payload_node.is_inside_tree():
				top_focus = payload_node.global_position
			var top_point: Vector3 = top_focus + Vector3(0.0, orbit_distance, 0.01)
			camera.global_position = top_point
			camera.look_at(top_focus, Vector3.FORWARD)
		_:
			var rad_yaw: float = deg_to_rad(orbit_yaw)
			var rad_pitch: float = deg_to_rad(orbit_pitch)
			var offset: Vector3 = Vector3(
				sin(rad_yaw) * cos(rad_pitch),
				sin(rad_pitch),
				cos(rad_yaw) * cos(rad_pitch)
			) * orbit_distance
			camera.global_position = assembly_center + offset
			camera.look_at(assembly_center, Vector3.UP)

func set_mode(mode: CameraMode) -> void:
	current_mode = mode
	match mode:
		CameraMode.ORBIT:
			orbit_distance = 9.2
			orbit_pitch = 16.0
			orbit_yaw = -38.0
		CameraMode.FOLLOW:
			follow_distance = 15.0
			follow_height = 3.5
		CameraMode.INSPECT_MOTORS:
			orbit_distance = 2.8
			orbit_pitch = 24.0
			orbit_yaw = -38.0
		CameraMode.TACTICAL_OVERVIEW:
			orbit_distance = 450.0
			orbit_pitch = 65.0
		CameraMode.TOP_DOWN_LAYOUT:
			orbit_distance = 3.0
			orbit_pitch = 89.0
	snap_to_target()

func _process(delta: float) -> void:
	if target_node == null:
		return

	# Target center of complete vehicle assembly:
	# Balloon top is at +2.5m, lower frame is at -2.95m -> vertical midpoint is -0.30m
	var assembly_center: Vector3 = target_node.global_position + Vector3(0.0, -0.30, 0.0)

	match current_mode:
		CameraMode.ORBIT:
			var rad_yaw: float = deg_to_rad(orbit_yaw)
			var rad_pitch: float = deg_to_rad(orbit_pitch)
			var offset: Vector3 = Vector3(
				sin(rad_yaw) * cos(rad_pitch),
				sin(rad_pitch),
				cos(rad_yaw) * cos(rad_pitch)
			) * orbit_distance

			camera.global_position = camera.global_position.lerp(assembly_center + offset, delta * 8.0)
			camera.look_at(assembly_center, Vector3.UP)

		CameraMode.FOLLOW:
			var vel: Vector3 = Vector3.ZERO
			if target_node is BalloonPhysics:
				vel = (target_node as BalloonPhysics).velocity_world

			var forward: Vector3 = Vector3(vel.x, 0.0, vel.z).normalized()
			if forward.length_squared() < 0.01:
				forward = Vector3(0.0, 0.0, 1.0)

			var desired_cam_pos: Vector3 = assembly_center - forward * follow_distance + Vector3(0.0, follow_height, 0.0)
			camera.global_position = camera.global_position.lerp(desired_cam_pos, delta * 5.0)
			camera.look_at(assembly_center, Vector3.UP)

		CameraMode.INSPECT_MOTORS:
			var motor_focus: Vector3 = target_node.global_position + Vector3(0.0, -2.95, 0.0)
			if payload_node != null and payload_node.is_inside_tree():
				motor_focus = payload_node.global_position

			var rad_yaw: float = deg_to_rad(orbit_yaw)
			var rad_pitch: float = deg_to_rad(orbit_pitch)
			var offset: Vector3 = Vector3(
				sin(rad_yaw) * cos(rad_pitch),
				sin(rad_pitch),
				cos(rad_yaw) * cos(rad_pitch)
			) * orbit_distance

			camera.global_position = camera.global_position.lerp(motor_focus + offset, delta * 12.0)
			camera.look_at(motor_focus, Vector3.UP)

		CameraMode.TACTICAL_OVERVIEW:
			var high_point: Vector3 = Vector3(assembly_center.x, assembly_center.y + orbit_distance, assembly_center.z + orbit_distance * 0.45)
			camera.global_position = camera.global_position.lerp(high_point, delta * 4.0)
			camera.look_at(assembly_center, Vector3.UP)

		CameraMode.TOP_DOWN_LAYOUT:
			var top_focus: Vector3 = target_node.global_position + Vector3(0.0, -2.95, 0.0)
			if payload_node != null and payload_node.is_inside_tree():
				top_focus = payload_node.global_position

			var top_point: Vector3 = top_focus + Vector3(0.0, orbit_distance, 0.01)
			camera.global_position = camera.global_position.lerp(top_point, delta * 10.0)
			camera.look_at(top_focus, Vector3.FORWARD)
