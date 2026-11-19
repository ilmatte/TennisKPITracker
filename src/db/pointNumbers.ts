import type { Point } from '../types';

export function nextPointNumber(points: readonly Pick<Point, 'point_number'>[]): number {
  return Math.max(0, ...points.map(point => point.point_number)) + 1;
}

export function normalizeDuplicatePointNumbers(points: readonly Point[]): Point[] {
  const pointsByGame = new Map<string, Point[]>();
  for (const point of points) {
    const gamePoints = pointsByGame.get(point.game_id) ?? [];
    gamePoints.push(point);
    pointsByGame.set(point.game_id, gamePoints);
  }

  const updates: Point[] = [];
  for (const gamePoints of pointsByGame.values()) {
    const orderedPoints = [...gamePoints].sort((a, b) =>
      a.point_number - b.point_number || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
    const usedNumbers = new Set<number>();
    let highestNumber = Math.max(0, ...orderedPoints.map(point => point.point_number));

    for (const point of orderedPoints) {
      if (usedNumbers.has(point.point_number)) {
        highestNumber += 1;
        updates.push({ ...point, point_number: highestNumber });
        usedNumbers.add(highestNumber);
      } else {
        usedNumbers.add(point.point_number);
      }
    }
  }

  return updates;
}
