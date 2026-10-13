extends SceneTree

func _init() -> void:
	root.size = Vector2i(1600, 900)
	DisplayServer.window_set_size(Vector2i(1600, 900))
	var main_scene = load("res://scenes/Main.tscn").instantiate()
	root.add_child(main_scene)
	_wait_and_capture(main_scene)

func _wait_and_capture(main_node: Node) -> void:
	for i in range(35):
		await process_frame
	
	var img: Image = root.get_texture().get_image()
	img.save_png("res://current_sim_screenshot.png")
	print("Saved screenshot to res://current_sim_screenshot.png (Size: %dx%d)" % [img.get_width(), img.get_height()])
	quit(0)
