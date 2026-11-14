const canvas = document.querySelector("canvas"), value = document.querySelector("#value"), context = canvas.getContext("2d");
function draw() { context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = "#101010"; context.font = "bold 110px monospace"; context.textBaseline = "middle"; context.fillText(`${Number(value.value).toFixed(2)} kWh`, 45, 140); }
document.querySelector("#draw").onclick = draw;
document.querySelector("#advance").onclick = () => { value.value = (Number(value.value) + 1.25).toFixed(2); draw(); };
document.querySelector("#download").onclick = () => { const link = document.createElement("a"); link.download = "synthetic-meter.png"; link.href = canvas.toDataURL("image/png"); link.click(); };
draw();
