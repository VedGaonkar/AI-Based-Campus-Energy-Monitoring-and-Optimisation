# Synthetic meter fixture

`synthetic-kwh.png` was rendered with Pillow using a system font: a clean `12345.67 kWh` display on white. It is not a physical meter photograph. It exercises real pixel OCR and carries no campus consumption claim. The interactive labelled scene is `/demo/virtual-meter/`.

Tests generate additional synthetic values/units/rotations. A deliberately exercised `5.00` image was recognised as `9.00` by the pinned OCR engine, illustrating that a high score is not an accuracy guarantee. Review/correction preserves the original text and candidate.
