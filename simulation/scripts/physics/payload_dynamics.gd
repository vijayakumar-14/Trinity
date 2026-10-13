class_name PayloadDynamics
extends Node3D

## Models 3D spherical pendulum dynamics, aerodynamic swaying, and damping of the suspended electronics payload.

@export var cable_length: float = 3.5 # Length of suspension lines (meters)
@export var damping_ratio: float = 0.55 # Critical damping ratio zeta
@export var payload_mass: float = 14.5 # kg

# Angular state: pitch (X-axis rotation) and roll (Z-axis rotation) in radians
var pitch_angle: float = 0.0
var pitch_velocity: float = 0.0
var roll_angle: float = 0.0
var roll_velocity: float = 0.0
var yaw_angle: float = 0.0
var yaw_velocity: float = 0.0

# Natural angular frequency: omega_0 = sqrt(g / L)
var natural_freq: float = 1.67

func _ready() -> void:
	natural_freq = sqrt(9.80665 / max(0.5, cable_length))

## Updates pendulum angles based on balloon acceleration and air-relative velocity on the payload.
func update_dynamics(balloon_accel: Vector3, air_rel_vel: Vector3, delta: float) -> void:
	if delta <= 0.0:
		return

	# Effective horizontal inertial forces acting on the payload
	# Godot 3D: X is right, Y is up, Z is back
	# An acceleration in +X tilts the pendulum backwards in -X (pitch or roll depending on frame)
	var accel_x: float = balloon_accel.x
	var accel_z: float = balloon_accel.z

	# Aerodynamic drag effect on payload pod
	var aero_force_x: float = -air_rel_vel.x * 0.15
	var aero_force_z: float = -air_rel_vel.z * 0.15

	# Effective driving accelerations
	var drive_x: float = (accel_x - aero_force_x) / max(0.5, cable_length)
	var drive_z: float = (accel_z - aero_force_z) / max(0.5, cable_length)

	# Pendulum differential equations:
	# d2theta/dt2 + 2*zeta*omega_0 * dtheta/dt + omega_0^2 * sin(theta) = -drive
	var restoring_roll: float = -(natural_freq * natural_freq) * sin(roll_angle)
	var damping_roll: float = -2.0 * damping_ratio * natural_freq * roll_velocity
	var roll_accel: float = restoring_roll + damping_roll - drive_x

	roll_velocity += roll_accel * delta
	roll_angle += roll_velocity * delta

	var restoring_pitch: float = -(natural_freq * natural_freq) * sin(pitch_angle)
	var damping_pitch: float = -2.0 * damping_ratio * natural_freq * pitch_velocity
	var pitch_accel: float = restoring_pitch + damping_pitch + drive_z

	pitch_velocity += pitch_accel * delta
	pitch_angle += pitch_velocity * delta

	# Clamp to physically reasonable tilt angles (+-45 degrees = 0.78 rad)
	roll_angle = clamp(roll_angle, -0.78, 0.78)
	pitch_angle = clamp(pitch_angle, -0.78, 0.78)

	# Anti-twist mechanical restraint:
	# 4-point equatorial suspension provides massive torsional restoring moment against line twist
	var torsional_stiffness: float = 52.0 # N*m / rad
	var torsional_damping: float = 14.0
	var yaw_accel: float = -torsional_stiffness * yaw_angle - torsional_damping * yaw_velocity
	yaw_velocity += yaw_accel * delta
	yaw_angle += yaw_velocity * delta
	yaw_angle = clamp(yaw_angle, -0.04, 0.04) # Mechanically constrained against line twist (<2.3 deg)

	# Apply rotation to node
	rotation = Vector3(pitch_angle, yaw_angle, roll_angle)

	# Compute local position offset relative to suspension collar (pivot at 0, 0, 0)
	# Spherical pendulum position
	var offset_x: float = sin(roll_angle) * cable_length
	var offset_z: float = -sin(pitch_angle) * cable_length
	var offset_y: float = -cos(max(abs(roll_angle), abs(pitch_angle))) * cable_length

	position = Vector3(offset_x, offset_y, offset_z)

func get_tilt_euler_deg() -> Vector3:
	return Vector3(rad_to_deg(pitch_angle), rad_to_deg(yaw_angle), rad_to_deg(roll_angle))
