class_name MissionManager
extends Node

## Coordinates mission phases, timeline progression, scenarios, simulation speeds, and lifecycle states.

enum Phase {
	PRE_LAUNCH = 0,
	ASCENT = 1,
	CRUISE = 2,
	WAYPOINT_APPROACH = 3,
	DESCENT_RECOVERY = 4,
	TOUCHDOWN = 5
}

signal phase_changed(new_phase: Phase, phase_name: String)
signal simulation_state_changed(is_paused: bool, time_scale: float)

@export var current_phase: Phase = Phase.PRE_LAUNCH
@export var time_scale: float = 1.0
@export var is_paused: bool = false

var mission_elapsed_time: float = 0.0
var step_requested: bool = false
var has_launched: bool = false

func _ready() -> void:
	pass

func tick_lifecycle(altitude: float, vertical_speed: float, dist_to_waypoint: float, delta: float) -> void:
	if is_paused and not step_requested:
		return

	step_requested = false
	mission_elapsed_time += delta

	# State-driven phase transitions based on actual physics
	var prev_phase: Phase = current_phase

	if not has_launched:
		current_phase = Phase.PRE_LAUNCH
	elif altitude <= 1.0 and mission_elapsed_time > 15.0:
		current_phase = Phase.TOUCHDOWN
	elif vertical_speed < -1.5 and altitude < 800.0:
		current_phase = Phase.DESCENT_RECOVERY
	elif dist_to_waypoint < 300.0:
		current_phase = Phase.WAYPOINT_APPROACH
	elif altitude > 800.0 and abs(vertical_speed) < 1.0:
		current_phase = Phase.CRUISE
	elif vertical_speed > 0.4:
		current_phase = Phase.ASCENT

	if current_phase != prev_phase:
		phase_changed.emit(current_phase, get_phase_name())

func launch_mission() -> void:
	has_launched = true
	is_paused = false
	current_phase = Phase.ASCENT
	phase_changed.emit(current_phase, get_phase_name())
	simulation_state_changed.emit(is_paused, time_scale)

func toggle_pause() -> void:
	is_paused = not is_paused
	simulation_state_changed.emit(is_paused, time_scale)

func step_single_frame() -> void:
	is_paused = true
	step_requested = true
	simulation_state_changed.emit(is_paused, time_scale)

func set_time_scale(new_scale: float) -> void:
	time_scale = clamp(new_scale, 0.1, 10.0)
	simulation_state_changed.emit(is_paused, time_scale)

func reset_mission() -> void:
	has_launched = false
	mission_elapsed_time = 0.0
	current_phase = Phase.PRE_LAUNCH
	is_paused = false
	phase_changed.emit(current_phase, get_phase_name())
	simulation_state_changed.emit(is_paused, time_scale)

func get_phase_name() -> String:
	match current_phase:
		Phase.PRE_LAUNCH:
			return "PRE-LAUNCH / PAD STANDBY"
		Phase.ASCENT:
			return "STRATOSPHERIC ASCENT"
		Phase.CRUISE:
			return "EQUILIBRIUM CRUISE"
		Phase.WAYPOINT_APPROACH:
			return "WAYPOINT CAPTURE"
		Phase.DESCENT_RECOVERY:
			return "CONTROLLED DESCENT"
		Phase.TOUCHDOWN:
			return "TOUCHDOWN / RECOVERY"
	return "UNKNOWN"
