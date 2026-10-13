class_name ExternalAIClient
extends Node

## Non-blocking HTTP client communicating with external Edge-AI inference service.
## Automatically detects service health, measures round-trip latency, and falls back seamlessly.

signal prediction_received(command: Dictionary)
signal connection_status_changed(connected: bool, message: String)

@export var server_url: String = "http://127.0.0.1:8000/predict"
@export var request_timeout_sec: float = 0.35

var _http_request: HTTPRequest
var is_service_available: bool = false
var last_latency_ms: float = 0.0
var _request_in_flight: bool = false
var _request_start_time: float = 0.0

func _ready() -> void:
	_http_request = HTTPRequest.new()
	_http_request.timeout = request_timeout_sec
	add_child(_http_request)
	_http_request.request_completed.connect(_on_request_completed)

func send_observation_async(sensor_obs: Dictionary, target_waypoint: Vector3, mode: int, time: float) -> void:
	if not is_inside_tree() or _request_in_flight:
		return # Avoid queue buildup, wait for previous response or tree attachment

	var payload: Dictionary = {
		"timestamp": time,
		"mode": mode,
		"target_waypoint": [target_waypoint.x, target_waypoint.y, target_waypoint.z],
		"sensors": sensor_obs
	}

	var json_str: String = JSON.stringify(payload)
	var headers: PackedStringArray = PackedStringArray([
		"Content-Type: application/json",
		"Accept: application/json"
	])

	_request_in_flight = true
	_request_start_time = Time.get_ticks_msec()

	var err: Error = _http_request.request(server_url, headers, HTTPClient.METHOD_POST, json_str)
	if err != OK:
		_request_in_flight = false
		_set_status(false, "Failed to initiate HTTP request (Error %d)" % err)

func _on_request_completed(result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	_request_in_flight = false
	var now_ms: float = Time.get_ticks_msec()
	last_latency_ms = now_ms - _request_start_time

	if result != HTTPRequest.RESULT_SUCCESS or response_code != 200:
		_set_status(false, "Inference service offline or error (HTTP %d, Code %d)" % [response_code, result])
		return

	var json_parse: JSON = JSON.new()
	var err: Error = json_parse.parse(body.get_string_from_utf8())
	if err != OK:
		_set_status(false, "Malformed JSON response from AI service")
		return

	var data: Variant = json_parse.data
	if typeof(data) != TYPE_DICTIONARY:
		_set_status(false, "Invalid AI response structure")
		return

	var dict: Dictionary = data as Dictionary
	_set_status(true, "AI service online (%0.1f ms latency)" % last_latency_ms)
	prediction_received.emit(dict)

func _set_status(connected: bool, message: String) -> void:
	if is_service_available != connected:
		is_service_available = connected
		connection_status_changed.emit(connected, message)
