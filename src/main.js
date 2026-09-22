import Phaser from 'phaser'
import './style.css'

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="command-center">
    <section class="workspace">
      <div class="map-frame">
        <div class="map-header">
          <div class="map-title"><span class="signal-icon" aria-hidden="true"></span> LIVE ROUTE PREVIEW</div>
          <div class="map-meta">NORTH IS UP <span>/</span> SCALE 1:1</div>
        </div>
        <div class="game-shell" id="game-shell">
          <div class="scene-actions action-buttons">
            <button class="replay-button" id="replay-track" type="button">
              <span class="button-glyph" aria-hidden="true">&#8635;</span>
              <span>REPLAY TRACK</span>
            </button>
            <button class="generate-button" id="generate-track" type="button">
              <span class="button-glyph" aria-hidden="true">+</span>
              <span>NEW TRACK</span>
            </button>
          </div>
          <div class="minimap-panel">
            <div class="minimap-label">MINIMAP</div>
            <canvas id="minimap" width="220" height="140" aria-label="Entire track minimap"></canvas>
          </div>
        </div>
      </div>

      <aside class="readout">
        <div class="readout-block readout-primary">
          <p class="eyebrow">CURRENT TRACK</p>
          <div class="track-id" id="track-id">----</div>
          <p class="readout-caption">procedural route signature</p>
        </div>
        <div class="readout-grid">
          <div class="metric"><span class="metric-label">ANCHORS</span><strong id="anchor-count">--</strong></div>
          <div class="metric"><span class="metric-label">LENGTH</span><strong id="track-length">--</strong><small>M</small></div>
          <div class="metric"><span class="metric-label">WIDTH</span><strong>08</strong><small>M</small></div>
          <div class="metric"><span class="metric-label">SURFACE</span><strong>DRY</strong></div>
        </div>
        <div class="readout-block telemetry">
          <div class="telemetry-head"><span>SCOUT TELEMETRY</span><span class="telemetry-live" id="telemetry-state">LIVE</span></div>
        <div class="telemetry-row"><span>VELOCITY</span><strong id="velocity-readout">064</strong><small>KM/H</small></div>
        <div class="telemetry-row"><span>HEADING</span><strong id="heading-readout">000</strong><small>DEG</small></div>
        <div class="telemetry-bar"><span id="telemetry-speed"></span></div>
      </div>
      <div class="readout-block lap-times">
        <div class="telemetry-head"><span>LAP TIMING</span><span id="lap-count">LAP 01</span></div>
        <div class="telemetry-row"><span>CURRENT LAP</span><strong id="current-lap-time">00:00.000</strong></div>
        <div class="telemetry-row"><span>PREVIOUS LAP</span><strong id="previous-lap-time">--:--.---</strong></div>
      </div>
      <div class="readout-block sensor-controls">
        <div class="telemetry-head"><span>FORWARD SENSOR</span><span class="telemetry-live" id="sensor-status">CLEAR</span></div>
        <label class="slider-label" for="max-speed"><span>MAX SPEED</span><output id="max-speed-value">064</output><small>KM/H</small></label>
        <input class="sensor-slider" id="max-speed" type="range" min="20" max="200" step="4" value="64" aria-label="Maximum speed">
        <label class="slider-label" for="laser-range"><span>LASER LENGTH</span><output id="laser-length-value">240</output><small>PX</small></label>
        <input class="sensor-slider" id="laser-range" type="range" min="80" max="320" step="10" value="240" aria-label="Laser length">
        <label class="slider-label" for="brake-force"><span>BRAKE FORCE</span><output id="brake-force-value">100</output><small>%</small></label>
        <input class="sensor-slider" id="brake-force" type="range" min="0" max="200" step="10" value="100" aria-label="Brake force">
        <label class="slider-label" for="steering-correction"><span>STEERING CORRECTION</span><output id="steering-correction-value">100</output><small>%</small></label>
        <input class="sensor-slider" id="steering-correction" type="range" min="0" max="200" step="10" value="100" aria-label="Steering correction">
        <div class="telemetry-head clearance-readout"><span>CORNER CLEARANCE</span><span class="telemetry-live" id="clearance-status">CLEAR</span></div>
      </div>
      <p class="readout-footnote">TRACK GENERATOR V1.0<br>READY FOR TRAFFIC AGENTS</p>
    </aside>
  </section>
  </main>
`

const TAU = Math.PI * 2
const GAME_WIDTH = 1280
const GAME_HEIGHT = 760
const WORLD_WIDTH = 3600
const WORLD_HEIGHT = 2400
const MAX_SPEED_LIMIT_KPH = 200

function createRandom(seed = Math.floor(Math.random() * 0xffffff)) {
  let value = seed >>> 0

  return () => {
    value += 0x6d2b79f5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function cubicBezier(first, controlFirst, controlSecond, last, amount) {
  const inverseAmount = 1 - amount
  const inverseSquared = inverseAmount * inverseAmount
  const amountSquared = amount * amount

  return {
    x: inverseSquared * inverseAmount * first.x
      + 3 * inverseSquared * amount * controlFirst.x
      + 3 * inverseAmount * amountSquared * controlSecond.x
      + amountSquared * amount * last.x,
    y: inverseSquared * inverseAmount * first.y
      + 3 * inverseSquared * amount * controlFirst.y
      + 3 * inverseAmount * amountSquared * controlSecond.y
      + amountSquared * amount * last.y,
  }
}

function buildBezierLoop(anchorPoints, samplesPerSegment = 48) {
  const handles = anchorPoints.map((anchor, index) => {
    const previous = anchorPoints[(index - 1 + anchorPoints.length) % anchorPoints.length]
    const next = anchorPoints[(index + 1) % anchorPoints.length]
    const tangentX = next.x - previous.x
    const tangentY = next.y - previous.y
    const tangentLength = Math.max(Math.hypot(tangentX, tangentY), 1)
    const handleLength = Math.min(distanceBetween(previous, anchor), distanceBetween(anchor, next)) * 0.26
    const directionX = tangentX / tangentLength
    const directionY = tangentY / tangentLength

    return {
      outgoing: {
        x: anchor.x + directionX * handleLength,
        y: anchor.y + directionY * handleLength,
      },
      incoming: {
        x: anchor.x - directionX * handleLength,
        y: anchor.y - directionY * handleLength,
      },
    }
  })
  const points = []

  for (let index = 0; index < anchorPoints.length; index += 1) {
    const nextIndex = (index + 1) % anchorPoints.length

    for (let step = 0; step < samplesPerSegment; step += 1) {
      points.push(cubicBezier(
        anchorPoints[index],
        handles[index].outgoing,
        handles[nextIndex].incoming,
        anchorPoints[nextIndex],
        step / samplesPerSegment,
      ))
    }
  }

  return points
}

function distanceBetween(first, second) {
  return Phaser.Math.Distance.Between(first.x, first.y, second.x, second.y)
}

function getTangent(points, index) {
  const previous = points[(index - 1 + points.length) % points.length]
  const next = points[(index + 1) % points.length]
  return Phaser.Math.Angle.Between(previous.x, previous.y, next.x, next.y)
}

function getNormal(angle) {
  return { x: -Math.sin(angle), y: Math.cos(angle) }
}

function getDistanceToTrack(points, position) {
  return getNearestTrackPoint(points, position).distance
}

function getNearestTrackPoint(points, position) {
  let nearestDistance = Infinity
  let nearestPoint = null

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]
    const end = points[(index + 1) % points.length]
    const segmentX = end.x - start.x
    const segmentY = end.y - start.y
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY
    const offsetX = position.x - start.x
    const offsetY = position.y - start.y
    const projection = segmentLengthSquared === 0
      ? 0
      : (offsetX * segmentX + offsetY * segmentY) / segmentLengthSquared
    const clampedProjection = Math.max(0, Math.min(1, projection))
    const closestX = start.x + segmentX * clampedProjection
    const closestY = start.y + segmentY * clampedProjection
    const distance = Phaser.Math.Distance.Between(position.x, position.y, closestX, closestY)

    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestPoint = { x: closestX, y: closestY }
    }
  }

  return { distance: nearestDistance, point: nearestPoint }
}

function getCrossProduct(first, second, third) {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
}

function isPointOnSegment(point, start, end) {
  const epsilon = 0.001
  return point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.y >= Math.min(start.y, end.y) - epsilon
    && point.y <= Math.max(start.y, end.y) + epsilon
}

function doSegmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstTurn = getCrossProduct(firstStart, firstEnd, secondStart)
  const secondTurn = getCrossProduct(firstStart, firstEnd, secondEnd)
  const thirdTurn = getCrossProduct(secondStart, secondEnd, firstStart)
  const fourthTurn = getCrossProduct(secondStart, secondEnd, firstEnd)
  const epsilon = 0.001

  const crosses = ((firstTurn > epsilon && secondTurn < -epsilon) || (firstTurn < -epsilon && secondTurn > epsilon))
    && ((thirdTurn > epsilon && fourthTurn < -epsilon) || (thirdTurn < -epsilon && fourthTurn > epsilon))

  return crosses
    || (Math.abs(firstTurn) <= epsilon && isPointOnSegment(secondStart, firstStart, firstEnd))
    || (Math.abs(secondTurn) <= epsilon && isPointOnSegment(secondEnd, firstStart, firstEnd))
    || (Math.abs(thirdTurn) <= epsilon && isPointOnSegment(firstStart, secondStart, secondEnd))
    || (Math.abs(fourthTurn) <= epsilon && isPointOnSegment(firstEnd, secondStart, secondEnd))
}

function hasSelfIntersection(points) {
  for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
    const firstEndIndex = (firstIndex + 1) % points.length

    for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
      const secondEndIndex = (secondIndex + 1) % points.length
      const adjacent = firstEndIndex === secondIndex
        || secondEndIndex === firstIndex
        || (firstIndex === 0 && secondEndIndex === 0)

      if (adjacent) continue

      if (doSegmentsIntersect(
        points[firstIndex],
        points[firstEndIndex],
        points[secondIndex],
        points[secondEndIndex],
      )) return true
    }
  }

  return false
}

function getWallDistanceAhead(points, position, heading, laserLength, wallDistance, sensorOffset) {
  const directionX = Math.cos(heading)
  const directionY = Math.sin(heading)
  const sampleStep = 10
  let previousBeamDistance = 0
  let previousTrackDistance = getDistanceToTrack(points, {
    x: position.x + directionX * sensorOffset,
    y: position.y + directionY * sensorOffset,
  })

  for (let beamDistance = sampleStep; beamDistance <= laserLength; beamDistance += sampleStep) {
    const sampleDistance = sensorOffset + beamDistance
    const samplePosition = {
      x: position.x + directionX * sampleDistance,
      y: position.y + directionY * sampleDistance,
    }
    const nearestTrackPoint = getNearestTrackPoint(points, samplePosition)
    const trackDistance = nearestTrackPoint.distance

    if (trackDistance >= wallDistance) {
      const distanceChange = trackDistance - previousTrackDistance
      const wallRatio = distanceChange <= 0
        ? 0
        : Phaser.Math.Clamp((wallDistance - previousTrackDistance) / distanceChange, 0, 1)
      const leftNormalX = Math.sin(heading)
      const leftNormalY = -Math.cos(heading)
      const lateralOffset = (nearestTrackPoint.point.x - samplePosition.x) * leftNormalX
        + (nearestTrackPoint.point.y - samplePosition.y) * leftNormalY
      const side = Math.abs(lateralOffset) < 8 ? 'FRONT' : lateralOffset > 0 ? 'RIGHT' : 'LEFT'

      return {
        distance: previousBeamDistance + (beamDistance - previousBeamDistance) * wallRatio,
        side,
      }
    }

    previousBeamDistance = beamDistance
    previousTrackDistance = trackDistance
  }

  return null
}

function getSideNormal(angle, side) {
  const leftNormal = { x: Math.sin(angle), y: -Math.cos(angle) }
  return side === 'left' ? leftNormal : { x: -leftNormal.x, y: -leftNormal.y }
}

function getBoundaryPoints(points, side, wallOffset) {
  return points.map((point, index) => {
    const normal = getSideNormal(getTangent(points, index), side)
    return {
      x: point.x + normal.x * wallOffset,
      y: point.y + normal.y * wallOffset,
    }
  })
}

function getClosestPointOnSegment(point, start, end) {
  const segmentX = end.x - start.x
  const segmentY = end.y - start.y
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY
  const offsetX = point.x - start.x
  const offsetY = point.y - start.y
  const projection = segmentLengthSquared === 0
    ? 0
    : (offsetX * segmentX + offsetY * segmentY) / segmentLengthSquared
  const amount = Math.max(0, Math.min(1, projection))
  const closest = {
    x: start.x + segmentX * amount,
    y: start.y + segmentY * amount,
  }

  return { point: closest, distance: distanceBetween(point, closest) }
}

function getSegmentCircleIntersections(start, end, center, radius) {
  const segmentX = end.x - start.x
  const segmentY = end.y - start.y
  const offsetX = start.x - center.x
  const offsetY = start.y - center.y
  const coefficientA = segmentX * segmentX + segmentY * segmentY
  if (coefficientA === 0) return []

  const coefficientB = 2 * (offsetX * segmentX + offsetY * segmentY)
  const coefficientC = offsetX * offsetX + offsetY * offsetY - radius * radius
  const discriminant = coefficientB * coefficientB - 4 * coefficientA * coefficientC
  if (discriminant < 0) return []

  const squareRoot = Math.sqrt(discriminant)
  const amounts = [
    (-coefficientB - squareRoot) / (2 * coefficientA),
    (-coefficientB + squareRoot) / (2 * coefficientA),
  ]

  return amounts
    .filter(amount => amount >= 0 && amount <= 1)
    .map(amount => ({
      x: start.x + segmentX * amount,
      y: start.y + segmentY * amount,
    }))
}

function getCornerWallContact(boundaryPoints, sensorCenter, heading, side, sensorRadius) {
  const directionX = Math.cos(heading)
  const directionY = Math.sin(heading)
  let nearest = null
  let intersection = null

  for (let index = 0; index < boundaryPoints.length; index += 1) {
    const start = boundaryPoints[index]
    const end = boundaryPoints[(index + 1) % boundaryPoints.length]
    const closest = getClosestPointOnSegment(sensorCenter, start, end)
    if (!nearest || closest.distance < nearest.distance) nearest = closest

    for (const candidate of getSegmentCircleIntersections(start, end, sensorCenter, sensorRadius)) {
      const relativeX = candidate.x - sensorCenter.x
      const relativeY = candidate.y - sensorCenter.y
      const forwardDistance = relativeX * directionX + relativeY * directionY
      if (!intersection || forwardDistance > intersection.forwardDistance) {
        intersection = { point: candidate, forwardDistance }
      }
    }
  }

  const contactPoint = intersection ? intersection.point : nearest.point
  const contactAngle = Phaser.Math.Angle.Wrap(
    Phaser.Math.Angle.Between(sensorCenter.x, sensorCenter.y, contactPoint.x, contactPoint.y) - heading,
  )

  return {
    center: sensorCenter,
    point: contactPoint,
    clearance: nearest.distance,
    intersects: Boolean(intersection),
    angle: contactAngle,
    side,
  }
}

function getCornerClearanceDetection(points, position, heading, wallOffset, sensorRadius, forwardOffset, lateralOffset) {
  const directionX = Math.cos(heading)
  const directionY = Math.sin(heading)
  const leftNormal = getSideNormal(heading, 'left')
  const sensorBase = {
    x: position.x + directionX * forwardOffset,
    y: position.y + directionY * forwardOffset,
  }
  const leftCenter = {
    x: sensorBase.x + leftNormal.x * lateralOffset,
    y: sensorBase.y + leftNormal.y * lateralOffset,
  }
  const rightCenter = {
    x: sensorBase.x - leftNormal.x * lateralOffset,
    y: sensorBase.y - leftNormal.y * lateralOffset,
  }
  const leftBoundary = getBoundaryPoints(points, 'left', wallOffset)
  const rightBoundary = getBoundaryPoints(points, 'right', wallOffset)

  return {
    left: getCornerWallContact(leftBoundary, leftCenter, heading, 'left', sensorRadius),
    right: getCornerWallContact(rightBoundary, rightCenter, heading, 'right', sensorRadius),
  }
}

function formatSeed(seed) {
  return seed.toString(16).toUpperCase().padStart(6, '0')
}

function formatLapTime(milliseconds) {
  if (milliseconds === null) return '--:--.---'

  const totalSeconds = milliseconds / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds % 60).toFixed(3).padStart(6, '0')
  return `${minutes.toString().padStart(2, '0')}:${seconds}`
}

function generateTrack(seed = Math.floor(Math.random() * 0xffffff)) {
  const random = createRandom(seed)
  const center = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 + 18 }
  let points = null
  let anchorPoints = null

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidateAnchors = []

    for (let index = 0; index < 8; index += 1) {
      const sectorStart = -Math.PI / 2 + index * TAU / 8
      const angle = sectorStart + 0.12 + random() * 0.54
      const isInnerAnchor = index % 2 === 0
      const radius = isInnerAnchor
        ? 0.52 + random() * 0.1
        : 0.84 + random() * 0.12
      candidateAnchors.push({
        x: center.x + Math.cos(angle) * radius * WORLD_WIDTH * 0.43,
        y: center.y + Math.sin(angle) * radius * WORLD_HEIGHT * 0.43,
      })
    }

    const candidatePoints = buildBezierLoop(candidateAnchors)

    if (!hasSelfIntersection(candidatePoints)) {
      points = candidatePoints
      anchorPoints = candidateAnchors
      break
    }
  }

  if (!points) {
    anchorPoints = Array.from({ length: 8 }, (_, index) => {
      const angle = -Math.PI / 2 + (index + 0.5) * TAU / 8
      const radius = index % 2 === 0 ? 0.58 : 0.9
      return {
        x: center.x + Math.cos(angle) * radius * WORLD_WIDTH * 0.43,
        y: center.y + Math.sin(angle) * radius * WORLD_HEIGHT * 0.43,
      }
    })
    points = buildBezierLoop(anchorPoints)
  }

  let length = 0

  for (let index = 0; index < points.length; index += 1) {
    length += distanceBetween(points[index], points[(index + 1) % points.length])
  }

  return {
    seed,
    id: formatSeed(seed),
    turnCount: anchorPoints.length,
    anchors: anchorPoints,
    points,
    length: Math.round(length / 5.6),
  }
}

class RaceTrackScene extends Phaser.Scene {
  constructor() {
    super('RaceTrackScene')
    this.track = null
    this.racer = null
    this.racerHeading = 0
    this.startLinePoint = null
    this.startLineHeading = 0
    this.previousCarPosition = null
    this.lapElapsedMs = 0
    this.previousLapTimeMs = null
    this.lapCount = 0
    this.hasLeftStart = false
    this.carCrashed = false
    this.maxSpeedKph = 64
    this.cruiseSpeed = 0.12
    this.speedPerKph = this.cruiseSpeed / this.maxSpeedKph
    this.driveSpeed = this.cruiseSpeed
    this.brakingResponseRate = 0.004
    this.accelerationResponseRate = 0.003
    this.roadWidth = 94
    this.racerCollisionRadius = 17
    this.laserLength = 240
    this.brakingDistance = 240
    this.brakeForceScale = 1
    this.cornerSensorRadius = 100
    this.cornerSensorForwardOffset = 20
    this.cornerSensorLateralOffset = 16
    this.steeringCorrectionScale = 1
    this.steeringRate = 0.005
    this.steeringCommand = 0
    this.laserGraphics = null
    this.cornerSensorGraphics = null
  }

  create() {
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
    this.drawBackdrop()
    this.generateNewTrack()

    this.input.keyboard.on('keydown-R', () => this.generateNewTrack())
  }

  update(_time, delta) {
    if (!this.track || !this.racer || this.carCrashed) return

    const wallDetection = this.getWallDetection()
    const clearanceDetection = this.getCornerClearanceDetection()
    this.updateSteering(clearanceDetection, delta)
    const safeSpeed = this.getSafeSpeed(wallDetection)
    const isBraking = this.driveSpeed > safeSpeed
    const responseRate = isBraking
      ? this.brakingResponseRate * this.brakeForceScale
      : this.accelerationResponseRate
    const response = 1 - Math.exp(-responseRate * delta)
    this.driveSpeed = Phaser.Math.Linear(this.driveSpeed, safeSpeed, response)
    const distance = this.driveSpeed * delta
    const nextX = this.racer.x + Math.cos(this.racerHeading) * distance
    const nextY = this.racer.y + Math.sin(this.racerHeading) * distance
    this.racer.setPosition(nextX, nextY)
    this.racer.setRotation(this.racerHeading)
    this.updateLapTimer(delta)

    const wallDistance = this.roadWidth / 2 - this.racerCollisionRadius
    if (getDistanceToTrack(this.track.points, this.racer) > wallDistance) {
      this.crashCar()
      return
    }

    const velocity = this.getVelocityKph()
    document.querySelector('#velocity-readout').textContent = velocity.toString().padStart(3, '0')
    document.querySelector('#heading-readout').textContent = Math.round(Phaser.Math.RadToDeg(this.racerHeading + TAU) % 360).toString().padStart(3, '0')
    this.updateLaser(wallDetection)
    const updatedClearanceDetection = this.getCornerClearanceDetection()
    this.updateCornerSensorLines(updatedClearanceDetection)
    this.updateClearanceReadout(updatedClearanceDetection)
    this.updateSensorReadout(wallDetection)
    this.updateMinimap()
  }

  generateNewTrack() {
    this.track = generateTrack()
    this.replayCurrentTrack()
  }

  replayCurrentTrack() {
    if (!this.track) return

    this.carCrashed = false
    this.driveSpeed = this.cruiseSpeed
    this.previousCarPosition = null
    this.lapElapsedMs = 0
    this.previousLapTimeMs = null
    this.lapCount = 0
    this.hasLeftStart = false
    this.renderTrack()
    this.updateReadout()
  }

  drawBackdrop() {
    const background = this.add.graphics()
    background.fillStyle(0x10201f, 1)
    background.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)

    background.lineStyle(1, 0x29413d, 0.48)
    for (let x = 0; x <= WORLD_WIDTH; x += 64) background.lineBetween(x, 0, x, WORLD_HEIGHT)
    for (let y = 0; y <= WORLD_HEIGHT; y += 64) background.lineBetween(0, y, WORLD_WIDTH, y)

    background.lineStyle(1, 0x315049, 0.32)
    for (let radius = 220; radius < 1400; radius += 140) {
      background.strokeCircle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 18, radius)
    }

    const horizon = this.add.graphics()
    horizon.lineStyle(1, 0x87a69b, 0.14)
    horizon.lineBetween(28, 54, 160, 54)
    horizon.lineBetween(WORLD_WIDTH - 160, WORLD_HEIGHT - 45, WORLD_WIDTH - 28, WORLD_HEIGHT - 45)
  }

  renderTrack() {
    if (this.trackLayer) this.trackLayer.destroy()
    if (this.racer) this.racer.destroy()

    this.trackLayer = this.add.container(0, 0)
    const { points } = this.track
    const outer = this.add.graphics()
    const road = this.add.graphics()
    const curbs = this.add.graphics()

    this.drawLoop(outer, points, 112, 0x0a1111, 1)
    this.drawLoop(road, points, this.roadWidth + 8, 0x8a948e, 1)
    this.drawLoop(road, points, this.roadWidth, 0x303b39, 1)
    this.drawCurbs(curbs, points)
    this.trackLayer.add([outer, road, curbs])
    this.drawStartFinish(points)
    this.createRacer(points)
    this.createCornerSensorLines()
    this.createLaserPointer()
    this.updateMinimap()
  }

  drawLoop(graphics, points, width, color, alpha) {
    graphics.lineStyle(width, color, alpha)
    graphics.beginPath()
    graphics.moveTo(points[0].x, points[0].y)
    for (let index = 1; index < points.length; index += 1) graphics.lineTo(points[index].x, points[index].y)
    graphics.lineTo(points[0].x, points[0].y)
    graphics.strokePath()
  }

  drawCurbs(graphics, points) {
    const curbWidth = this.roadWidth / 2 + 3
    for (let index = 0; index < points.length; index += 4) {
      const nextIndex = (index + 4) % points.length
      const angle = getTangent(points, index)
      const normal = getNormal(angle)
      const isLight = Math.floor(index / 4) % 2 === 0
      const color = isLight ? 0xe4dfc8 : 0xe0664f
      graphics.lineStyle(7, color, 0.95)
      graphics.lineBetween(
        points[index].x + normal.x * curbWidth,
        points[index].y + normal.y * curbWidth,
        points[nextIndex].x + normal.x * curbWidth,
        points[nextIndex].y + normal.y * curbWidth,
      )
      graphics.lineBetween(
        points[index].x - normal.x * curbWidth,
        points[index].y - normal.y * curbWidth,
        points[nextIndex].x - normal.x * curbWidth,
        points[nextIndex].y - normal.y * curbWidth,
      )
    }
  }

  drawStartFinish(points) {
    const start = points[0]
    const angle = getTangent(points, 0)
    const normal = getNormal(angle)
    const marker = this.add.container(start.x, start.y)
    const markerGraphics = this.add.graphics()
    const squareSize = 11
    const acrossCount = 8

    for (let index = 0; index < acrossCount; index += 1) {
      const offset = (index - (acrossCount - 1) / 2) * squareSize
      const x = normal.x * offset
      const y = normal.y * offset
      markerGraphics.fillStyle(index % 2 === 0 ? 0xf2ecda : 0x182120, 1)
      markerGraphics.fillRect(x - Math.cos(angle) * squareSize / 2, y - Math.sin(angle) * squareSize / 2, squareSize, squareSize)
    }

    marker.add(markerGraphics)
    marker.setRotation(angle)
    this.trackLayer.add(marker)
    const startLabel = this.add.text(start.x + 18, start.y - 44, 'START / FINISH', {
      fontFamily: 'Space Mono',
      fontSize: '11px',
      color: '#f1e7c5',
      backgroundColor: '#10201f',
      padding: { left: 5, right: 5, top: 3, bottom: 3 },
    }).setAlpha(0.9)
    this.trackLayer.add(startLabel)
  }

  createRacer(points) {
    const firstPoint = points[0]
    this.racerHeading = getTangent(points, 0)
    const racer = this.add.container(firstPoint.x, firstPoint.y)
    const glow = this.add.ellipse(0, 0, 48, 28, 0xe9674e, 0.13)
    const body = this.add.graphics()
    body.fillStyle(0xe9674e, 1)
    body.fillRoundedRect(-17, -9, 34, 18, 5)
    body.fillStyle(0xf5d4a2, 1)
    body.fillRoundedRect(-4, -6, 12, 12, 3)
    body.fillStyle(0x152020, 1)
    body.fillRect(10, -7, 5, 14)
    body.fillRect(-15, -11, 7, 4)
    body.fillRect(-15, 7, 7, 4)
    const beacon = this.add.circle(13, 0, 2.5, 0xffe5a4, 1)

    racer.add([glow, body, beacon])
    racer.setRotation(this.racerHeading)
    racer.setDepth(10)
    this.racer = racer
    this.startLinePoint = { x: firstPoint.x, y: firstPoint.y }
    this.startLineHeading = this.racerHeading
    this.cameras.main.startFollow(this.racer, true, 0.08, 0.08)
  }

  createLaserPointer() {
    this.laserGraphics = this.add.graphics()
    this.laserGraphics.setDepth(8)
    this.trackLayer.add(this.laserGraphics)
  }

  createCornerSensorLines() {
    this.cornerSensorGraphics = this.add.graphics()
    this.cornerSensorGraphics.setDepth(7)
    this.trackLayer.add(this.cornerSensorGraphics)
  }

  getCornerClearanceDetection() {
    return getCornerClearanceDetection(
      this.track.points,
      this.racer,
      this.racerHeading,
      this.roadWidth / 2,
      this.cornerSensorRadius,
      this.cornerSensorForwardOffset,
      this.cornerSensorLateralOffset,
    )
  }

  updateCornerSensorLines(clearanceDetection) {
    if (!this.cornerSensorGraphics) return

    const graphics = this.cornerSensorGraphics
    graphics.clear()
    const sensors = [
      { sensor: clearanceDetection.left, color: 0xe9674e },
      { sensor: clearanceDetection.right, color: 0x42d879 },
    ]

    for (const { sensor, color } of sensors) {
      graphics.lineStyle(2, color, 0.95)
      graphics.lineBetween(sensor.center.x, sensor.center.y, sensor.point.x, sensor.point.y)
      this.drawSensorAngle(graphics, sensor, color)
    }
  }

  drawSensorAngle(graphics, sensor, color) {
    const arcRadius = 28
    const steps = Math.max(4, Math.ceil(Math.abs(sensor.angle) * 12))

    graphics.lineStyle(2, color, 0.95)
    graphics.beginPath()
    for (let step = 0; step <= steps; step += 1) {
      const angle = this.racerHeading + sensor.angle * step / steps
      const x = sensor.center.x + Math.cos(angle) * arcRadius
      const y = sensor.center.y + Math.sin(angle) * arcRadius
      if (step === 0) graphics.moveTo(x, y)
      else graphics.lineTo(x, y)
    }
    graphics.strokePath()
  }

  updateSteering(clearanceDetection, delta) {
    const leftClearance = clearanceDetection.left.clearance
    const rightClearance = clearanceDetection.right.clearance
    const clearanceBias = Phaser.Math.Clamp(
      (rightClearance - leftClearance) / this.cornerSensorRadius,
      -1,
      1,
    )
    const leftAngleBias = clearanceDetection.left.intersects
      ? Phaser.Math.Clamp(clearanceDetection.left.angle / (Math.PI / 2), -1, 1)
      : 0
    const rightAngleBias = clearanceDetection.right.intersects
      ? Phaser.Math.Clamp(clearanceDetection.right.angle / (Math.PI / 2), -1, 1)
      : 0
    const angleBias = (leftAngleBias + rightAngleBias) * 0.5
    let steeringBias = Phaser.Math.Clamp(clearanceBias * 0.65 + angleBias * 0.35, -1, 1)
    steeringBias = Phaser.Math.Clamp(steeringBias * this.steeringCorrectionScale, -1, 1)

    const steeringDirectionChanged = steeringBias !== 0
      && this.steeringCommand !== 0
      && Math.sign(steeringBias) !== Math.sign(this.steeringCommand)

    this.steeringCommand = steeringDirectionChanged
      ? steeringBias
      : Phaser.Math.Linear(this.steeringCommand, steeringBias, Math.min(delta / 100, 1))
    this.racerHeading += this.steeringCommand * this.steeringRate * delta
  }

  updateClearanceReadout(clearanceDetection) {
    const status = document.querySelector('#clearance-status')
    if (!status) return

    const leftDistance = Math.round(clearanceDetection.left.clearance).toString().padStart(3, '0')
    const rightDistance = Math.round(clearanceDetection.right.clearance).toString().padStart(3, '0')
    const hasDetection = clearanceDetection.left.intersects || clearanceDetection.right.intersects

    status.textContent = `${hasDetection ? 'WALL' : 'CLEAR'} L ${leftDistance} / R ${rightDistance}`
    status.classList.toggle('sensor-warning', hasDetection)
  }

  getWallDetection() {
    return getWallDistanceAhead(
      this.track.points,
      this.racer,
      this.racerHeading,
      this.laserLength,
      this.roadWidth / 2,
      this.racerCollisionRadius,
    )
  }

  getSafeSpeed(wallDetection) {
    if (!wallDetection) return this.cruiseSpeed

    const distanceRatio = Phaser.Math.Clamp(wallDetection.distance / this.brakingDistance, 0, 1)
    return this.cruiseSpeed * Math.sqrt(distanceRatio)
  }

  getVelocityKph() {
    return Math.max(0, Math.round(this.driveSpeed / this.speedPerKph))
  }

  getStartLineProjection(position) {
    const offsetX = position.x - this.startLinePoint.x
    const offsetY = position.y - this.startLinePoint.y
    return offsetX * Math.cos(this.startLineHeading) + offsetY * Math.sin(this.startLineHeading)
  }

  updateLapTimer(delta) {
    if (!this.previousCarPosition || !this.startLinePoint) {
      this.previousCarPosition = { x: this.racer.x, y: this.racer.y }
      return
    }

    this.lapElapsedMs += delta
    const previousProjection = this.getStartLineProjection(this.previousCarPosition)
    const currentProjection = this.getStartLineProjection(this.racer)

    if (currentProjection > 24) this.hasLeftStart = true

    if (this.hasLeftStart && previousProjection < 0 && currentProjection >= 0) {
      this.previousLapTimeMs = this.lapElapsedMs
      this.lapElapsedMs = 0
      this.lapCount += 1
    }

    this.previousCarPosition = { x: this.racer.x, y: this.racer.y }
    this.updateLapReadout()
  }

  updateLapReadout() {
    document.querySelector('#current-lap-time').textContent = formatLapTime(this.lapElapsedMs)
    document.querySelector('#previous-lap-time').textContent = formatLapTime(this.previousLapTimeMs)
    document.querySelector('#lap-count').textContent = `LAP ${Math.min(this.lapCount + 1, 99).toString().padStart(2, '0')}`
  }

  updateMinimap() {
    const canvas = document.querySelector('#minimap')
    if (!canvas || !this.track || !this.racer) return

    const context = canvas.getContext('2d')
    if (!context) return

    const padding = 14
    const points = this.track.points
    const bounds = points.reduce((current, point) => ({
      minX: Math.min(current.minX, point.x),
      minY: Math.min(current.minY, point.y),
      maxX: Math.max(current.maxX, point.x),
      maxY: Math.max(current.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
    const spanX = Math.max(bounds.maxX - bounds.minX, 1)
    const spanY = Math.max(bounds.maxY - bounds.minY, 1)
    const scale = Math.min((canvas.width - padding * 2) / spanX, (canvas.height - padding * 2) / spanY)
    const offsetX = (canvas.width - spanX * scale) / 2 - bounds.minX * scale
    const offsetY = (canvas.height - spanY * scale) / 2 - bounds.minY * scale
    const mapPoint = point => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY })
    const drawTrackPath = () => {
      context.beginPath()
      const firstPoint = mapPoint(points[0])
      context.moveTo(firstPoint.x, firstPoint.y)
      for (let index = 1; index < points.length; index += 1) {
        const point = mapPoint(points[index])
        context.lineTo(point.x, point.y)
      }
      context.closePath()
    }

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#0d1515'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.lineJoin = 'round'
    context.lineCap = 'round'

    drawTrackPath()
    context.strokeStyle = '#0a1111'
    context.lineWidth = Math.max(8, 112 * scale)
    context.stroke()
    drawTrackPath()
    context.strokeStyle = '#303b39'
    context.lineWidth = Math.max(5, this.roadWidth * scale)
    context.stroke()

    const start = mapPoint(points[0])
    context.fillStyle = '#e8e2a6'
    context.fillRect(start.x - 2, start.y - 2, 4, 4)

    const car = mapPoint(this.racer)
    context.fillStyle = '#e9674e'
    context.beginPath()
    context.arc(car.x, car.y, 4, 0, TAU)
    context.fill()
    context.strokeStyle = '#f5d4a2'
    context.lineWidth = 1
    context.stroke()
    context.strokeStyle = '#e9674e'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(car.x, car.y)
    context.lineTo(car.x + Math.cos(this.racerHeading) * 9, car.y + Math.sin(this.racerHeading) * 9)
    context.stroke()
  }

  updateLaser(wallDetection) {
    if (!this.laserGraphics || !this.racer) return

    const directionX = Math.cos(this.racerHeading)
    const directionY = Math.sin(this.racerHeading)
    const startDistance = this.racerCollisionRadius
    const endDistance = startDistance + this.laserLength
    const color = wallDetection ? 0xe9674e : 0xe8e2a6
    const graphics = this.laserGraphics

    graphics.clear()
    graphics.lineStyle(8, color, 0.1)
    graphics.lineBetween(
      this.racer.x + directionX * startDistance,
      this.racer.y + directionY * startDistance,
      this.racer.x + directionX * endDistance,
      this.racer.y + directionY * endDistance,
    )
    graphics.lineStyle(2, color, 0.85)
    graphics.lineBetween(
      this.racer.x + directionX * startDistance,
      this.racer.y + directionY * startDistance,
      this.racer.x + directionX * endDistance,
      this.racer.y + directionY * endDistance,
    )

    if (wallDetection) {
      const hitDistance = startDistance + wallDetection.distance
      graphics.fillStyle(0xe9674e, 0.95)
      graphics.fillCircle(
        this.racer.x + directionX * hitDistance,
        this.racer.y + directionY * hitDistance,
        4,
      )
    }
  }

  updateSensorReadout(wallDetection) {
    const status = document.querySelector('#sensor-status')
    if (!status) return

    if (wallDetection) {
      status.textContent = `WALL ${wallDetection.side} ${Math.round(wallDetection.distance).toString().padStart(3, '0')}`
      status.classList.add('sensor-warning')
    } else {
      status.textContent = 'CLEAR'
      status.classList.remove('sensor-warning')
    }
  }

  setLaserLength(length) {
    this.laserLength = Phaser.Math.Clamp(Number(length), 80, 320)
    document.querySelector('#laser-length-value').textContent = this.laserLength.toString()

    const wallDetection = this.getWallDetection()
    this.updateLaser(wallDetection)
    this.updateSensorReadout(wallDetection)
  }

  setMaxSpeed(speed) {
    this.maxSpeedKph = Phaser.Math.Clamp(Number(speed), 20, MAX_SPEED_LIMIT_KPH)
    this.cruiseSpeed = this.maxSpeedKph * this.speedPerKph
    this.driveSpeed = Math.min(this.driveSpeed, this.cruiseSpeed)
    document.querySelector('#max-speed-value').textContent = this.maxSpeedKph.toString().padStart(3, '0')
  }

  setBrakeForceScale(scale) {
    this.brakeForceScale = Phaser.Math.Clamp(Number(scale) / 100, 0, 2)
    document.querySelector('#brake-force-value').textContent = Math.round(this.brakeForceScale * 100).toString()
  }

  setSteeringCorrectionScale(scale) {
    this.steeringCorrectionScale = Phaser.Math.Clamp(Number(scale) / 100, 0, 2)
    document.querySelector('#steering-correction-value').textContent = Math.round(this.steeringCorrectionScale * 100).toString()
  }

  crashCar() {
    this.carCrashed = true
    this.driveSpeed = 0
    document.querySelector('#velocity-readout').textContent = '000'
    document.querySelector('#telemetry-state').textContent = 'CRASHED'
    document.querySelector('#telemetry-speed').style.width = '0%'
    this.updateLaser({ distance: 0 })
    this.updateSensorReadout({ distance: 0, side: 'FRONT' })

    const sparks = this.add.graphics()
    sparks.lineStyle(3, 0xe9674e, 0.95)
    for (let index = 0; index < 8; index += 1) {
      const angle = index / 8 * TAU
      const innerRadius = 10
      const outerRadius = 22 + Phaser.Math.Between(0, 9)
      sparks.lineBetween(
        Math.cos(angle) * innerRadius,
        Math.sin(angle) * innerRadius,
        Math.cos(angle) * outerRadius,
        Math.sin(angle) * outerRadius,
      )
    }
    sparks.setPosition(this.racer.x, this.racer.y)
    sparks.setDepth(11)

    const crashLabel = this.add.text(this.racer.x + 22, this.racer.y - 34, 'CRASHED', {
      fontFamily: 'Space Mono',
      fontSize: '11px',
      color: '#f1e7c5',
      backgroundColor: '#10201f',
      padding: { left: 5, right: 5, top: 3, bottom: 3 },
    })
    crashLabel.setDepth(12)
    this.trackLayer.add([sparks, crashLabel])
    const clearanceDetection = this.getCornerClearanceDetection()
    this.updateCornerSensorLines(clearanceDetection)
    this.updateClearanceReadout(clearanceDetection)
    this.updateMinimap()
    this.updateLapReadout()
  }

  updateReadout() {
    document.querySelector('#track-id').textContent = this.track.id
    document.querySelector('#anchor-count').textContent = this.track.turnCount.toString().padStart(2, '0')
    document.querySelector('#track-length').textContent = this.track.length.toString().padStart(3, '0')
    document.querySelector('#velocity-readout').textContent = this.getVelocityKph().toString().padStart(3, '0')
    document.querySelector('#heading-readout').textContent = Math.round(Phaser.Math.RadToDeg(this.racerHeading + TAU) % 360).toString().padStart(3, '0')
    document.querySelector('#telemetry-state').textContent = 'LIVE'
    document.querySelector('#telemetry-speed').style.width = `${Math.min(this.getVelocityKph() / MAX_SPEED_LIMIT_KPH * 100, 100)}%`
    document.querySelector('#max-speed').value = this.maxSpeedKph.toString()
    document.querySelector('#max-speed-value').textContent = this.maxSpeedKph.toString().padStart(3, '0')
    document.querySelector('#laser-range').value = this.laserLength.toString()
    document.querySelector('#laser-length-value').textContent = this.laserLength.toString()
    document.querySelector('#brake-force').value = Math.round(this.brakeForceScale * 100).toString()
    document.querySelector('#brake-force-value').textContent = Math.round(this.brakeForceScale * 100).toString()
    document.querySelector('#steering-correction').value = Math.round(this.steeringCorrectionScale * 100).toString()
    document.querySelector('#steering-correction-value').textContent = Math.round(this.steeringCorrectionScale * 100).toString()
    this.updateLapReadout()
    const wallDetection = this.getWallDetection()
    const clearanceDetection = this.getCornerClearanceDetection()
    this.updateLaser(wallDetection)
    this.updateCornerSensorLines(clearanceDetection)
    this.updateClearanceReadout(clearanceDetection)
    this.updateSensorReadout(wallDetection)
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: 'game-shell',
  backgroundColor: '#10201f',
  antialias: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  scene: RaceTrackScene,
})

document.querySelector('#generate-track').addEventListener('click', () => {
  game.scene.getScene('RaceTrackScene').generateNewTrack()
})

document.querySelector('#max-speed').addEventListener('input', (event) => {
  game.scene.getScene('RaceTrackScene').setMaxSpeed(event.target.value)
})

document.querySelector('#replay-track').addEventListener('click', () => {
  game.scene.getScene('RaceTrackScene').replayCurrentTrack()
})

document.querySelector('#laser-range').addEventListener('input', (event) => {
  game.scene.getScene('RaceTrackScene').setLaserLength(event.target.value)
})

document.querySelector('#brake-force').addEventListener('input', (event) => {
  game.scene.getScene('RaceTrackScene').setBrakeForceScale(event.target.value)
})

document.querySelector('#steering-correction').addEventListener('input', (event) => {
  game.scene.getScene('RaceTrackScene').setSteeringCorrectionScale(event.target.value)
})
