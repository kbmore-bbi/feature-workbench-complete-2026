from scripts.render_spcs_spec import render_template


TEMPLATE = """spec:
  containers:
    - name: backend
    # BEGIN COCO_SIDECAR
    - name: coco-agent
      image: ${IMAGE}
    # END COCO_SIDECAR
    - name: frontend
      image: ${IMAGE}
"""


def test_coco_sidecar_is_removed_by_default():
    rendered = render_template(TEMPLATE, {"IMAGE": "workbench:latest"})

    assert "coco-agent" not in rendered
    assert "frontend" in rendered


def test_coco_sidecar_can_be_restored_explicitly():
    rendered = render_template(
        TEMPLATE,
        {"IMAGE": "workbench:latest", "COCO_SIDECAR_ENABLED": "true"},
    )

    assert "coco-agent" in rendered
    assert "BEGIN COCO_SIDECAR" not in rendered
