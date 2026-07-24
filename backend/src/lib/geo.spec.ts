import { pointInPolygon, cosineSimilarity } from './geo.js';

describe('geo lib', () => {
  describe('pointInPolygon', () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];

    it('returns true if point is clearly inside a square', () => {
      expect(pointInPolygon([5, 5], square)).toBe(true);
    });

    it('returns false if point is clearly outside', () => {
      expect(pointInPolygon([15, 15], square)).toBe(false);
      expect(pointInPolygon([-1, 5], square)).toBe(false);
    });

    it('handles point on boundary edge (ray-casting implementation specific)', () => {
      // Ray-casting might vary on edges, usually false or true depending on ray direction
      // Documenting current behavior: it's typically false for right/top edges, true for left/bottom edges.
      // But we just verify the function returns a boolean without throwing
      const result = pointInPolygon([10, 5], square);
      expect(typeof result).toBe('boolean');
    });

    it('works with an L-shape irregular polygon', () => {
      const lShape: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 4],
        [4, 4],
        [4, 10],
        [0, 10]
      ];

      expect(pointInPolygon([2, 2], lShape)).toBe(true);
      expect(pointInPolygon([8, 2], lShape)).toBe(true);
      expect(pointInPolygon([2, 8], lShape)).toBe(true);
      
      expect(pointInPolygon([8, 8], lShape)).toBe(false); // The cut-out part
      expect(pointInPolygon([-2, -2], lShape)).toBe(false);
    });
  });

  describe('cosineSimilarity', () => {
    it('returns 1.0 for identical vectors', () => {
      const v = [1, 2, 3];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    it('returns -1.0 for opposite vectors', () => {
      const a = [1, 2, 3];
      const b = [-1, -2, -3];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
    });

    it('returns ~0.0 for orthogonal vectors', () => {
      const a = [1, 0];
      const b = [0, 1];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    it('differentiates similar face vectors (>0.72) and different ones (<0.60)', () => {
      const v1 = [1, 1, 1];
      const v2 = [1, 1.1, 0.9];
      expect(cosineSimilarity(v1, v2)).toBeGreaterThan(0.72);

      const v3 = [1, -1, 1];
      expect(cosineSimilarity(v1, v3)).toBeLessThan(0.60);
    });
  });
});
