class_name BalloonAssembly
extends Node3D

## Hierarchical assembly combining the balloon envelope, 4 suspension cables,
## lower structural motor frame with 4 BLDC motors, and the electronics payload.

@export var config: SimulationConfig
@export var envelope_view: EnvelopeView
@export var suspension_rig: SuspensionRig
@export var payload_dynamics: PayloadDynamics
@export var motor_frame: MotorFrame
@export var payload_view: PayloadView

var suspension_pivot: Node3D

func _ready() -> void:
	if config == null:
		config = SimulationConfig.new()

	if envelope_view == null:
		envelope_view = EnvelopeView.new()
		envelope_view.name = "Envelope"
		add_child(envelope_view)
		if not is_inside_tree():
			envelope_view._ready()

	# Suspension pivot at envelope neck collar (Z=0, Y=-2.65, X=0)
	suspension_pivot = Node3D.new()
	suspension_pivot.name = "SuspensionPivot"
	suspension_pivot.position = Vector3(0.0, -2.65, 0.0)
	add_child(suspension_pivot)

	if payload_dynamics == null:
		payload_dynamics = PayloadDynamics.new()
		payload_dynamics.name = "PayloadDynamics"
		payload_dynamics.cable_length = config.suspension_cable_length
		payload_dynamics.damping_ratio = 0.55
		suspension_pivot.add_child(payload_dynamics)
		if not is_inside_tree():
			payload_dynamics._ready()

	# Rigid lower assembly containing the 4-motor frame and the central avionics payload
	if motor_frame == null:
		motor_frame = MotorFrame.new()
		motor_frame.name = "MotorFrame"
		motor_frame.config = config
		payload_dynamics.add_child(motor_frame)
		if not is_inside_tree():
			motor_frame._ready()

	if payload_view == null:
		payload_view = PayloadView.new()
		payload_view.name = "Payload"
		payload_view.position = Vector3(0.0, 0.08, 0.0)
		motor_frame.add_child(payload_view)
		if not is_inside_tree():
			payload_view._ready()

	if suspension_rig == null:
		suspension_rig = SuspensionRig.new()
		suspension_rig.name = "SuspensionRig"
		suspension_rig.envelope_view = envelope_view
		suspension_rig.motor_frame = motor_frame
		add_child(suspension_rig)
		if not is_inside_tree():
			suspension_rig._ready()

## Updates payload dynamics and BLDC motor physics on each physics step.
func update_assembly(balloon_accel: Vector3, air_rel_vel: Vector3, delta: float) -> Dictionary:
	if payload_dynamics != null:
		payload_dynamics.update_dynamics(balloon_accel, air_rel_vel, delta)

	if motor_frame != null:
		return motor_frame.update_motors_physics(delta)

	return {}

func get_payload_tilt_deg() -> Vector3:
	if payload_dynamics != null:
		return payload_dynamics.get_tilt_euler_deg()
	return Vector3.ZERO

func get_motor_telemetry() -> Array:
	if motor_frame != null:
		var list: Array = []
		for m in motor_frame.motors:
			list.append({
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
		return list
	return []

func get_payload_global_position() -> Vector3:
	if motor_frame != null:
		return motor_frame.global_position
	return global_position + Vector3(0.0, -6.45, 0.0)
