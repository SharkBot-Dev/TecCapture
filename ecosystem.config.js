module.exports = {
  apps : [{
    name: "tec-capture",
    script: "gunicorn",
    args: "-w 1 -b 0.0.0.0:5108 app:app",
    interpreter: ".venv/bin/python3",
    watch: false
  }]
}