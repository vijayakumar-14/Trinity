extends SceneTree

func _init() -> void:
	root.size = Vector2i(1600, 900)
	var main_scene = load("res://scenes/Main.tscn").instantiate()
	root.add_child(main_scene)
	_wait_and_capture(main_scene)

func _wait_and_capture(main_node: Node) -> void:
	# Wait for scene ready and initial physics settling
	for i in range(25):
		await process_frame

	var cam_ctrl = main_node.get_node_or_null("CameraController")
	print("cam_ctrl found after settling: ", cam_ctrl != null)

	# 1. Capture Orbit Overview View
	var img_orbit: Image = root.get_texture().get_image()
	img_orbit.save_png("res://current_sim_screenshot.png")
	print("Captured Orbit view to current_sim_screenshot.png")

	# 2. Switch to Motor Inspection View (Camera Mode 2 / INSPECT_MOTORS)
	if cam_ctrl:
		cam_ctrl.set_mode(2)
		cam_ctrl.snap_to_target()

	for i in range(15):
		await process_frame

	var img_motors: Image = root.get_texture().get_image()
	img_motors.save_png("res://inspect_motors_screenshot.png")
	print("Captured Motor Inspection view to inspect_motors_screenshot.png")

	quit(0)
