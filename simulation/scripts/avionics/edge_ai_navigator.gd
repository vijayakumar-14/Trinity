class_name EdgeAINavigator
extends Node

## Layer B: Autonomous Edge-AI Navigation Planner with multi-waypoint sequencing,
## wind drift feed-forward compensation, and 4-BLDC-motor authority management.

enum NavMode {
	AUTONOMOUS_WAYPOINT = 0,   ## Active 4-BLDC motor waypoint following
	STATION_KEEPING = 1,       ## Position-hold loiter against atmospheric wind
	MANUAL_MOTOR_TEST = 2,     ## Direct manual motor throttle test mode
	PASSIVE_DRIFT = 3          ## Motors disengaged / drift observation
}

@export var config: SimulationConfig
@export var nav_mode: NavMode = NavMode.AUTONOMOUS_WAYPOINT
@export var use_external_ai: bool = false

# Multi-waypoint route
var waypoints: Array[Vector3] = []
var current_waypoint_index: int = 0
var active_target_waypoint: Vector3 = Vector3.ZERO
var distance_to_waypoint: float = 0.0
var bearing_to_waypoint_deg: float = 0.0

# Desired generalized forces for Layer C (MotorAllocator)
var desired_fx: float = 0.0 # Newtons
var desired_fz: float = 0.0 # Newtons
var desired_tau_y: float = 0.0 # N*m
var desired_buoyancy_trim: float = 0.0 # Newtons

# Manual test inputs for M1..M4
var manual_throttles: Array[float] = [0.0, 0.0, 0.0, 0.0]

# Planner telemetry status
var planner_status: String = "STANDBY"
var planner_action: String = "Awaiting Mission Launch"
var navigation_confidence: float = 0.95
var is_authority_exceeded: bool = false
var route_completed: bool = false

# PD Gains for waypoint tracking
const KP_POS: float = 0.045
const KD_VEL: float = 0.65
const KYAW: float = 0.4

func _ready() -> void:
	if config == null:
		config = SimulationConfig.new()
	waypoints = config.mission_waypoints.duplicate()
	if not waypoints.is_empty():
		active_target_waypoint = waypoints[0]

## Core planning cycle: receives estimated state from Layer A and computes desired forces.
func plan_navigation_cycle(est_state: Dictionary, delta: float) -> Dictionary:
	var est_pos: Vector3 = est_state.get("position", Vector3.ZERO)
	var est_vel: Vector3 = est_state.get("velocity", Vector3.ZERO)
	var est_wind: Vector3 = est_state.get("wind_velocity", Vector3.ZERO)
	var batt_pct: float = est_state.get("battery_percent", 100.0)
	var motor_health: Array = est_state.get("motor_health", [true, true, true, true])

	# Check battery depletion (Scenario 7)
	if batt_pct < 4.0 and nav_mode != NavMode.PASSIVE_DRIFT:
		nav_mode = NavMode.PASSIVE_DRIFT
		planner_status = "CRITICAL_BATTERY_SHUTDOWN"
		planner_action = "Motors deactivated to prevent cell damage. Passive float active."

	# 1. Multi-waypoint sequencing
	_update_waypoint_progress(est_pos)

	match nav_mode:
		NavMode.AUTONOMOUS_WAYPOINT, NavMode.STATION_KEEPING:
			_compute_active_motor_guidance(est_pos, est_vel, est_wind, delta)

		NavMode.MANUAL_MOTOR_TEST:
			desired_fx = 0.0
			desired_fz = 0.0
			desired_tau_y = 0.0
			desired_buoyancy_trim = 0.0
			planner_status = "MANUAL_MOTOR_OVERRIDE"
			planner_action = "M1: %0.0f%% | M2: %0.0f%% | M3: %0.0f%% | M4: %0.0f%%" % [
				manual_throttles[0] * 100.0, manual_throttles[1] * 100.0,
				manual_throttles[2] * 100.0, manual_throttles[3] * 100.0
			]

		NavMode.PASSIVE_DRIFT:
			desired_fx = 0.0
			desired_fz = 0.0
			desired_tau_y = 0.0
			desired_buoyancy_trim = 0.0
			planner_status = "PASSIVE_DRIFT_ACTIVE"
			planner_action = "Zero motor thrust. Drifting with ambient wind vector."

	# Check motor failure warning (Scenario 8)
	var failed_count: int = 0
	for h in motor_health:
		if not h:
			failed_count += 1
	if failed_count > 0:
		planner_status = "DEGRADED_AUTHORITY (%d MOTOR FAULT)" % failed_count
		navigation_confidence = max(0.5, navigation_confidence - 0.25)

	return {
		"nav_mode": nav_mode,
		"desired_fx": desired_fx,
		"desired_fz": desired_fz,
		"desired_tau_y": desired_tau_y,
		"desired_buoyancy_trim": desired_buoyancy_trim,
		"active_waypoint": active_target_waypoint,
		"waypoint_index": current_waypoint_index,
		"total_waypoints": waypoints.size(),
		"distance_to_waypoint": distance_to_waypoint,
		"bearing_to_waypoint_deg": bearing_to_waypoint_deg,
		"planner_status": planner_status,
		"planner_action": planner_action,
		"confidence": navigation_confidence,
		"authority_exceeded": is_authority_exceeded,
		"manual_throttles": manual_throttles.duplicate()
	}

## Manages sequential waypoint progression (WP 1 -> WP 2 -> WP 3).
func _update_waypoint_progress(pos: Vector3) -> void:
	if waypoints.is_empty():
		return

	active_target_waypoint = waypoints[current_waypoint_index]
	var delta_pos: Vector3 = active_target_waypoint - pos
	var horiz_dist: float = Vector2(delta_pos.x, delta_pos.z).length()
	distance_to_waypoint = horiz_dist

	if horiz_dist > 0.5:
		bearing_to_waypoint_deg = fposmod(rad_to_deg(atan2(delta_pos.x, -delta_pos.z)), 360.0)

	var capture_radius: float = config.waypoint_arrival_radius if config != null else 35.0

	# Arrival threshold check
	if horiz_dist < capture_radius and abs(pos.y - active_target_waypoint.y) < 60.0:
		if current_waypoint_index < waypoints.size() - 1:
			current_waypoint_index += 1
			active_target_waypoint = waypoints[current_waypoint_index]
			planner_action = "Waypoint %d captured! Routing to Waypoint %d" % [current_waypoint_index, current_waypoint_index + 1]
		else:
			route_completed = true
			nav_mode = NavMode.STATION_KEEPING
			planner_status = "FINAL_WAYPOINT_STATION_HOLD"
			planner_action = "Station-keeping active at target destination."

## Computes corrective horizontal forces compensating for wind drift and tracking target.
func _compute_active_motor_guidance(pos: Vector3, vel: Vector3, wind_v: Vector3, _delta: float) -> void:
	var delta_pos: Vector3 = active_target_waypoint - pos

	# 1. Feed-forward wind drag compensation:
	# Balloon naturally drifts toward wind_v. To oppose or hold against wind, thrust must cancel wind drag:
	var rho_approx: float = 1.15
	var drag_area: float = config.envelope_reference_area * config.envelope_drag_coeff
	var wind_speed: float = wind_v.length()
	var f_wind_oppose: Vector3 = -wind_v.normalized() * (0.5 * rho_approx * drag_area * (wind_speed * wind_speed) * 0.12)

	# 2. Closed-loop PD waypoint positioning control:
	var f_pd_x: float = delta_pos.x * KP_POS - vel.x * KD_VEL
	var f_pd_z: float = delta_pos.z * KP_POS - vel.z * KD_VEL

	# Total requested horizontal force
	desired_fx = f_wind_oppose.x + f_pd_x
	desired_fz = f_wind_oppose.z + f_pd_z

	# Total authority limit (4 motors * 5.7 N max = ~22.8 N max)
	var max_avail_thrust: float = 22.0
	var req_mag: float = Vector2(desired_fx, desired_fz).length()

	if req_mag > max_avail_thrust:
		is_authority_exceeded = true
		desired_fx = (desired_fx / req_mag) * max_avail_thrust
		desired_fz = (desired_fz / req_mag) * max_avail_thrust
		planner_status = "WIND_EXCEEDS_MOTOR_AUTHORITY"
		planner_action = "Strong wind exceeds 22.8N motor capability. Residual drift occurring."
	else:
		is_authority_exceeded = false
		planner_status = "ACTIVE_4_BLDC_NAVIGATION"
		planner_action = "Motors correcting drift: WP %d [%0.0fm dist, Brg: %0.0f°]" % [
			current_waypoint_index + 1, distance_to_waypoint, bearing_to_waypoint_deg
		]

	# 3. Heading / yaw stabilization
	desired_tau_y = 0.0 # Maintain neutral yaw alignment

	# 4. Vertical buoyancy trim
	var alt_err: float = active_target_waypoint.y - pos.y
	desired_buoyancy_trim = clamp(alt_err * 8.0, -35.0, 35.0)
