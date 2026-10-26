"""Raw debug-event projection paired with the TypeScript SDK's debug-events.spec.ts."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from deepseek_harness import DeepSeekHarness


EXPECTED = Path(__file__).parent / "expected" / "debug-events.json"


def test_durable_debug_events_project_through_the_sdk_wire(tmp_path: Path) -> None:
    expected = json.loads(EXPECTED.read_text(encoding="utf-8"))
    script = tmp_path / "debug_runtime.py"
    script.write_text(
        """
import json
import os
import sys

seq = 0

def notify(method, params):
    print(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}), flush=True)

def event(session_id, type_, data):
    global seq
    notify("session.event", {"sessionId": session_id, "event": {"type": type_, "seq": seq, "time": 0, "data": data}})
    seq += 1

for line in sys.stdin:
    message = json.loads(line)
    if message["method"] == "initialize":
        result = {"serverInfo": {"name": "debug-fixture"}}
    elif message["method"] == "session/prompt":
        session_id = message["params"]["sessionId"]
        event(session_id, "agent/inbox/spliced", {"target": "next-turn", "start": 0,
            "inserted": [{"id": "accepted", "role": "user", "content": [], "source": {"kind": "user"}}]})
        notify("session.status", {"sessionId": session_id, "status": "running"})
        print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": {"messageId": "accepted"}}), flush=True)
        event(session_id, "turn/start", {"turn": 0})
        event(session_id, "assistant/message", {"turn": 0, "step": 0, "message": {"id": "fake-assistant",
            "role": "assistant", "content": [{"type": "text", "text": os.environ["MAIN_RESPONSE"]}],
            "source": {"kind": "model", "provider": "fake", "model": "fake"}}})
        for debug_event in json.loads(os.environ["DEBUG_EVENTS"]):
            notify("session.event", {"sessionId": session_id, "event": {**debug_event, "seq": seq, "time": 0}})
            seq += 1
        event(session_id, "turn/end", {"turn": 0, "reason": {"kind": "completed"}})
        notify("session.status", {"sessionId": session_id, "status": "idle"})
        continue
    elif message["method"] == "shutdown":
        print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": {}}), flush=True)
        break
    else:
        raise RuntimeError("Unexpected protocol method")
    print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)
""".strip(), encoding="utf-8",
    )
    with DeepSeekHarness(
        _launch_args=(sys.executable, str(script)), cwd=str(tmp_path),
        env={"MAIN_RESPONSE": expected["finalResponse"], "DEBUG_EVENTS": json.dumps(expected["debugEvents"])},
    ) as harness:
        result = harness.run("Start the debug scenario.", session_id="sdk-debug-events")
    debug_notifications = [notification for notification in result.notifications
                           if notification.method == "session.event"
                           and notification.payload["event"]["type"].startswith("debug/")]
    assert all(notification.payload["sessionId"] == result.session_id for notification in debug_notifications)
    projection = {
        "finalResponse": result.final_response,
        "debugEvents": [event for event in result.events if event["type"].startswith("debug/")],
        "debugNotifications": [{"method": notification.method, "event": notification.payload["event"]}
                               for notification in debug_notifications],
        "assistantTexts": [block["text"] for event in result.events if event["type"] == "assistant/message"
                           for block in event["data"]["message"]["content"] if block["type"] == "text"],
    }
    assert projection == expected
    assert [event["type"] for event in projection["debugEvents"]] == [
        "debug/session-started", "debug/stopped", "debug/control", "debug/session-ended",
    ]
    for event in projection["debugEvents"]:
        assert event["ignorable"] is True
        assert "surfaceOp" not in event
        assert "sourceEventSeqs" not in event
