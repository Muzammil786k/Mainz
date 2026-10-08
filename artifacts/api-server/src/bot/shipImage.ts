import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { logger } from "../lib/logger";

const WIDTH = 640;
const HEIGHT = 260;
const AVATAR_SIZE = 128;
const AVATAR_Y = 36;
const LEFT_AVATAR_X = 40;
const RIGHT_AVATAR_X = WIDTH - 40 - AVATAR_SIZE;
const FETCH_TIMEOUT_MS = 5000;

async function fetchAvatar(url: string): Promise<Image | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Avatar request failed with status ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return await loadImage(buffer);
  } catch (err) {
    logger.warn({ err }, "Failed to load avatar for ship image; using fallback circle");
    return null;
  }
}

function drawAvatar(ctx: SKRSContext2D, image: Image | null, x: number, y: number): void {
  const radius = AVATAR_SIZE / 2;
  const cx = x + radius;
  const cy = y + radius;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (image) {
    ctx.drawImage(image, x, y, AVATAR_SIZE, AVATAR_SIZE);
  } else {
    ctx.fillStyle = "#5865f2";
    ctx.fillRect(x, y, AVATAR_SIZE, AVATAR_SIZE);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
}

function drawHeart(ctx: SKRSContext2D, cx: number, cy: number, size: number): void {
  const top = cy - size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, top + size * 0.3);
  ctx.bezierCurveTo(cx, top, cx - size * 0.5, top, cx - size * 0.5, top + size * 0.3);
  ctx.bezierCurveTo(
    cx - size * 0.5,
    top + size * 0.6,
    cx,
    top + size * 0.8,
    cx,
    top + size,
  );
  ctx.bezierCurveTo(
    cx,
    top + size * 0.8,
    cx + size * 0.5,
    top + size * 0.6,
    cx + size * 0.5,
    top + size * 0.3,
  );
  ctx.bezierCurveTo(cx + size * 0.5, top, cx, top, cx, top + size * 0.3);
  ctx.closePath();
  ctx.fillStyle = "#ff4d88";
  ctx.fill();
}

/**
 * Renders a ship card with both avatars, a heart, a compatibility bar and the
 * percentage. Avatars that cannot be fetched are replaced by a solid circle.
 * Returns the PNG bytes.
 */
export async function renderShipImage(
  firstAvatarUrl: string,
  secondAvatarUrl: string,
  score: number,
): Promise<Buffer> {
  const percent = Math.max(0, Math.min(100, Math.round(score)));
  const [firstAvatar, secondAvatar] = await Promise.all([
    fetchAvatar(firstAvatarUrl),
    fetchAvatar(secondAvatarUrl),
  ]);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, "#2b2d31");
  background.addColorStop(1, "#4a1d3a");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawAvatar(ctx, firstAvatar, LEFT_AVATAR_X, AVATAR_Y);
  drawAvatar(ctx, secondAvatar, RIGHT_AVATAR_X, AVATAR_Y);
  drawHeart(ctx, WIDTH / 2, AVATAR_Y + AVATAR_SIZE / 2, 72);

  const barX = 40;
  const barY = 198;
  const barWidth = WIDTH - 80;
  const barHeight = 28;

  ctx.fillStyle = "#1e1f22";
  ctx.fillRect(barX, barY, barWidth, barHeight);
  ctx.fillStyle = "#ff4d88";
  ctx.fillRect(barX, barY, (barWidth * percent) / 100, barHeight);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ffffff";
  ctx.strokeRect(barX, barY, barWidth, barHeight);

  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`${percent}%`, WIDTH / 2, barY + barHeight / 2);

  return canvas.encode("png");
}
