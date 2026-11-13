"""Local bounded JSON-lines pixel processor. No users, control decisions or network access.

Instrumented mode decodes a QR from actual supplied pixels. HOG mode only reports
positive people; no detection is unknown, never evidence of an empty room.
"""
import base64
import io
import json
import sys
import time
import cv2
import numpy as np
from PIL import Image

cv2.setNumThreads(1)
Image.MAX_IMAGE_PIXELS = 960 * 720
qr = cv2.QRCodeDetector()
hog = cv2.HOGDescriptor()
hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
VERSION = "opencv-" + cv2.__version__ + "/campus-demo-v1"

def process(request):
    started = time.monotonic()
    if request["mode"] == "health":
        return {"available": True, "modelVersion": VERSION, "personDetector": "OpenCV default HOG/SVM; positive-only"}
    raw = base64.b64decode(request["image"], validate=True)
    if len(raw) > 250000:
        raise ValueError("Image exceeds 250KB")
    with Image.open(io.BytesIO(raw)) as header:
        width, height = header.size
        if header.format not in ("JPEG", "PNG") or min(width, height) < 64 or width > 960 or height > 720:
            raise ValueError("Expected JPEG/PNG, 64px minimum, at most 960x720")
        actual_mime = "image/jpeg" if header.format == "JPEG" else "image/png"
        if request.get("mime") != actual_mime:
            raise ValueError("Image type does not match declared MIME")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Unreadable image")
    usable = float(np.std(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY))) > 12
    result = {"modelVersion": VERSION, "usable": usable, "width": width, "height": height,
              "occupancy": "unknown", "equipment": "unknown", "confidence": None,
              "reason": "Insufficient visual evidence", "dataMode": "simulated"}
    if request["mode"] == "instrumented":
        marker, points, _ = qr.detectAndDecode(image)
        # Small display QR cells suffer downsampling/moire. A bounded second
        # scale and lower-frame crop improve decoding without inventing evidence.
        if not marker:
            marker, points, _ = qr.detectAndDecode(cv2.resize(image, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))
        if not marker:
            lower = image[height // 3:, :]
            marker, points, _ = qr.detectAndDecode(cv2.resize(lower, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))
        result.update({"marker": marker[:300] if marker else "", "source": "instrumented_demo_vision",
                       "reason": "QR decoded from submitted pixels" if marker else "No readable demo QR in frame"})
    elif request["mode"] == "camera_inference":
        if usable and width >= 64 and height >= 128:
            boxes, weights = hog.detectMultiScale(image, winStride=(8, 8), padding=(8, 8), scale=1.05)
            people = [{"box": [int(x) for x in box], "score": round(float(weight), 3)}
                      for box, weight in zip(boxes, weights) if float(weight) >= 0.5]
            result.update({"occupancy": "occupied" if people else "unknown", "people": people,
                           "reason": "HOG person-positive evidence" if people else "No reliable person positive; vacancy not established"})
        result["source"] = "camera_inference"
    else:
        raise ValueError("Unsupported pixel-processing mode")
    thumb = cv2.resize(image, (min(320, width), max(1, round(height * min(320, width) / width))))
    ok, encoded = cv2.imencode(".jpg", thumb, [cv2.IMWRITE_JPEG_QUALITY, 60])
    result["thumbnail"] = base64.b64encode(encoded).decode() if ok else None
    result["processingMs"] = round((time.monotonic() - started) * 1000)
    return result

def main():
    for line in sys.stdin:
        try:
            if len(line) > 400000:
                raise ValueError("Input too large")
            request = json.loads(line)
            response = {"id": request["id"], "result": process(request)}
        except Exception as error:
            response = {"id": locals().get("request", {}).get("id"), "error": type(error).__name__}
        print(json.dumps(response), flush=True)

if __name__ == "__main__":
    main()
