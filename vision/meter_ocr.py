"""One bounded JSON request; no network, URLs, credentials or device controls."""
import base64
import io
import json
import os
import sys
import warnings

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.environ.get("OCR_MODULE_PATH", os.path.join(root, ".local", "ocr-python")))

def main(data):
    from PIL import Image, ImageOps
    import tesserocr
    Image.MAX_IMAGE_PIXELS = 4000000
    warnings.simplefilter("error", Image.DecompressionBombWarning)
    tessdata = os.environ.get("OCR_TESSDATA_PATH", os.path.join(root, ".local", "ocr-tessdata"))
    with tesserocr.PyTessBaseAPI(path=tessdata, lang="eng", psm=tesserocr.PSM.SINGLE_BLOCK) as api:
        if data.get("op") == "health":
            return {"available": True, "engine": tesserocr.tesseract_version().splitlines()[0], "binding": tesserocr.__version__}
        results = []
        for frame in data["images"]:
            raw = base64.b64decode(frame["image"], validate=True)
            if len(raw) > 256000:
                raise ValueError("image limit")
            try:
                with Image.open(io.BytesIO(raw)) as original:
                    expected = "PNG" if frame["mime"] == "image/png" else "JPEG"
                    if original.format != expected or original.width > 1920 or original.height > 1920:
                        raise ValueError("image format/dimension limit")
                    original.load()
                    image = ImageOps.exif_transpose(original).convert("RGB")
            except OSError as error:
                raise ValueError("invalid image bytes") from error
            # Orientation is clockwise; ROI is expressed in the oriented frame.
            image = image.rotate(-int(data["configuration"]["orientation"]), expand=True)
            w, h = image.size
            roi = data["configuration"]["roi"]
            image = image.crop((int(w*roi["x"]), int(h*roi["y"]), int(w*(roi["x"]+roi["width"])), int(h*(roi["y"]+roi["height"]))))
            if min(image.size) < 12:
                raise ValueError("ROI too small")
            image = ImageOps.autocontrast(ImageOps.grayscale(image))
            scale = min(2, 1000/max(image.size))
            image = image.resize((max(1, int(image.width*scale)), max(1, int(image.height*scale))), Image.Resampling.LANCZOS)
            api.SetImage(image)
            text = api.GetUTF8Text()[:4096]
            confidence = api.MeanTextConf()/100
            results.append({"text": text, "confidence": confidence, "width": w, "height": h})
        return {"frames": results, "engine": tesserocr.tesseract_version().splitlines()[0], "binding": tesserocr.__version__, "preprocessing": "EXIF, clockwise rotation, configured ROI, grayscale/autocontrast, bounded resize"}

try:
    payload = sys.stdin.buffer.read(800001)
    if len(payload) > 800000:
        raise ValueError("input limit")
    result = main(json.loads(payload))
    print(json.dumps({"result": result}))
except (ImportError, RuntimeError, OSError):
    print(json.dumps({"error": "OCR_UNAVAILABLE"}))
except Exception:
    print(json.dumps({"error": "INVALID_METER_IMAGE"}))
