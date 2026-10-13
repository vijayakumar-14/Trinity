class_name MotorController
extends Node

## Layer C: Motor Controller managing 4-BLDC-motor allocation, actuator limits,
## fault injection, and manual test override commands.

signal allocation_updated(allocation_data: Dictionary)

@export var config: SimulationConfig
@export var motor_frame: MotorFrame

var allocator: MotorAllocator
var is_manual_override: bool = false
var latest_allocation_data: Dictionary = {}

func _ready() -> void:
	if config == null:
		config = SimulationConfig.new()
	allocator = MotorAllocator.new(config)

## Updates control allocation and dispatches commands to the 4 BLDC motors.
func update_motor_control(desired_fx: float, desired_fz: float, desired_tau_y: float, manual_throttles: Array[float]) -> Dictionary:
	if motor_frame == null:
		return {}

	if is_manual_override:
		# Direct manual motor override
		motor_frame.set_motor_throttles(manual_throttles)
		latest_allocation_data = {
			"motor_commands": manual_throttles,
			"achieved_fx": 0.0,
			"achieved_fz": 0.0,
			"achieved_tau_y": 0.0,
			"residual_error": 0.0,
			"is_feasible": true,
			"is_manual": true
		}
	else:
		# Autonomous allocation via Moore-Penrose pseudoinverse
		var alloc_res: Dictionary = allocator.allocate_controls(desired_fx, desired_fz, desired_tau_y)
		var cmds: Array[float] = alloc_res.get("motor_commands", [0.0, 0.0, 0.0, 0.0])
		motor_frame.set_motor_throttles(cmds)
		latest_allocation_data = alloc_res
		latest_allocation_data["is_manual"] = false

	allocation_updated.emit(latest_allocation_data)
	return latest_allocation_data

## Injects failure on a specific motor (1 to 4) for Scenario 8.
func set_motor_failure(motor_id: int, is_failed: bool) -> void:
	var idx: int = motor_id - 1
	if idx >= 0 and idx < 4:
		if motor_frame != null and motor_frame.motors.size() > idx:
			motor_frame.motors[idx].inject_fault(is_failed)
		if allocator != null:
			allocator.set_motor_failed(idx, is_failed)
