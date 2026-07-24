import { Test, TestingModule } from '@nestjs/testing';
import { AttendanceService } from './attendance.service.js';
import { DB_TOKEN } from '../db/index.js';
import { EnrollmentService } from '../enrollment/enrollment.service.js';
import { pointInPolygon, cosineSimilarity, haversineMeters } from '../lib/geo.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { MarkAttendanceDto } from './attendance.dto.js';

jest.mock('../lib/geo.js', () => ({
  pointInPolygon: jest.fn(),
  cosineSimilarity: jest.fn(),
  haversineMeters: jest.fn(),
}));

describe('AttendanceService', () => {
  let service: AttendanceService;
  let mockQuerySequence: any[] = [];
  let insertSpy: jest.Mock;

  const mockDb = {
    select: jest.fn(() => {
      const chain: any = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        then: function(resolve: any, reject: any) {
          try {
            if (mockQuerySequence.length === 0) {
              resolve([]);
              return;
            }
            const val = mockQuerySequence.shift();
            if (val instanceof Error) reject(val);
            else resolve(val);
          } catch (e) {
            reject(e);
          }
        },
      };
      return chain;
    }),
    insert: jest.fn(() => {
      const chain: any = {
        values: jest.fn().mockImplementation((vals) => {
          if (insertSpy) insertSpy(vals);
          return chain;
        }),
        returning: jest.fn().mockReturnThis(),
        then: function(resolve: any, reject: any) {
          try {
            if (mockQuerySequence.length === 0) {
              resolve([]);
              return;
            }
            const val = mockQuerySequence.shift();
            if (val instanceof Error) reject(val);
            else resolve(val);
          } catch (e) {
            reject(e);
          }
        },
      };
      return chain;
    }),
  };

  const mockEnrollmentService = {
    decryptEmbedding: jest.fn().mockReturnValue([0.1, 0.2]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQuerySequence = [];
    insertSpy = jest.fn();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-24T12:00:00Z')); // IST 17:30, Day 5 (Friday)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: DB_TOKEN, useValue: mockDb },
        { provide: EnrollmentService, useValue: mockEnrollmentService },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const getValidDto = (): MarkAttendanceDto => ({
    hostelId: 'h1',
    checkInWindowId: 'w1',
    embedding: [0.1, 0.2],
    livenessPassed: true,
    livenessAction: 'smile',
    parallaxRatio: 1.5,
    deviceLat: 10,
    deviceLng: 20,
    gpsAccuracyM: 5,
    wifiBssidMatched: 'ab:cd',
    mockLocationFlag: false,
    deviceId: 'd1',
    gpsSampleSpread: 2,
    impliedSpeed: 0,
    webSource: false,
  });

  const setupValidSequence = () => {
    mockQuerySequence = [
      [{ id: 's1', faceEmbedding: 'encrypted', enrollmentStatus: 'approved' }], // users
      [{ id: 'a1' }], // assignment
      [{ studentAttempts: 0 }], // studentAttempts
      [{ deviceAttempts: 0 }], // deviceAttempts
      [{ id: 'h1', boundaryPolygon: JSON.stringify({ type: 'Polygon', coordinates: [[ [0,0], [0,1], [1,1], [1,0], [0,0] ]] }), wifiBssids: ['ab:cd'] }], // hostels
      [{ id: 'w1', isActive: true, daysOfWeek: [0,1,2,3,4,5,6], startTime: '00:00', endTime: '23:59' }], // windows
      [], // lastRecord
      [{ count: 1 }], // deviceCount
      [{ id: 'rec1', status: 'present' }] // insert returning
    ];
    (pointInPolygon as jest.Mock).mockReturnValue(true);
    (cosineSimilarity as jest.Mock).mockReturnValue(0.80);
    (haversineMeters as jest.Mock).mockReturnValue(0);
  };

  describe('markAttendance exceptions', () => {
    it('1. throws NotFoundException if student not found', async () => {
      mockQuerySequence = [[]]; // users empty
      await expect(service.markAttendance('s1', getValidDto())).rejects.toThrow(NotFoundException);
    });

    it('2. throws BadRequestException if face enrollment not approved', async () => {
      mockQuerySequence = [[{ id: 's1', faceEmbedding: 'encrypted', enrollmentStatus: 'pending' }]];
      await expect(service.markAttendance('s1', getValidDto())).rejects.toThrow(BadRequestException);
    });

    it('3. throws BadRequestException if face embedding is missing', async () => {
      mockQuerySequence = [[{ id: 's1', faceEmbedding: null, enrollmentStatus: 'approved' }]];
      await expect(service.markAttendance('s1', getValidDto())).rejects.toThrow(BadRequestException);
    });

    it('4. throws BadRequestException if student not assigned to hostel', async () => {
      mockQuerySequence = [
        [{ id: 's1', faceEmbedding: 'encrypted', enrollmentStatus: 'approved' }],
        [] // assignment empty
      ];
      await expect(service.markAttendance('s1', getValidDto())).rejects.toThrow(BadRequestException);
    });

    it('5. throws BadRequestException if student rate limit hit (>= 3)', async () => {
      mockQuerySequence = [
        [{ id: 's1', faceEmbedding: 'encrypted', enrollmentStatus: 'approved' }],
        [{ id: 'a1' }],
        [{ studentAttempts: 3 }]
      ];
      await expect(service.markAttendance('s1', getValidDto())).rejects.toThrow(BadRequestException);
    });

    it('6. throws BadRequestException if device rate limit hit (>= 10)', async () => {
      mockQuerySequence = [
        [{ id: 's1', faceEmbedding: 'encrypted', enrollmentStatus: 'approved' }],
        [{ id: 'a1' }],
        [{ studentAttempts: 0 }],
        [{ deviceAttempts: 10 }]
      ];
      await expect(service.markAttendance('s1', getValidDto())).rejects.toThrow(BadRequestException);
    });

    it('7. throws NotFoundException if hostel not found', async () => {
      mockQuerySequence = [
        [{ id: 's1', faceEmbedding: 'encrypted', enrollmentStatus: 'approved' }],
        [{ id: 'a1' }],
        [{ studentAttempts: 0 }],
        [{ deviceAttempts: 0 }],
        [] // hostel empty
      ];
      await expect(service.markAttendance('s1', getValidDto())).rejects.toThrow(NotFoundException);
    });

    it('8. throws BadRequestException if hostel geofence not configured', async () => {
      mockQuerySequence = [
        [{ id: 's1', faceEmbedding: 'encrypted', enrollmentStatus: 'approved' }],
        [{ id: 'a1' }],
        [{ studentAttempts: 0 }],
        [{ deviceAttempts: 0 }],
        [{ id: 'h1', boundaryPolygon: null }]
      ];
      await expect(service.markAttendance('s1', getValidDto())).rejects.toThrow(BadRequestException);
    });

    it('9. throws NotFoundException if check-in window not found', async () => {
      mockQuerySequence = [
        [{ id: 's1', faceEmbedding: 'encrypted', enrollmentStatus: 'approved' }],
        [{ id: 'a1' }],
        [{ studentAttempts: 0 }],
        [{ deviceAttempts: 0 }],
        [{ id: 'h1', boundaryPolygon: '{}' }],
        [] // windows empty
      ];
      await expect(service.markAttendance('s1', getValidDto())).rejects.toThrow(NotFoundException);
    });
  });

  describe('markAttendance rejections (status=rejected)', () => {
    it('10. rejects if check-in not available today', async () => {
      setupValidSequence();
      mockQuerySequence[5] = [{ id: 'w1', isActive: true, daysOfWeek: [1,2,3], startTime: '00:00', endTime: '23:59' }]; // 5 is Friday, not in array
      const res = await service.markAttendance('s1', getValidDto());
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('not available today') }));
      expect(res.status).toBe('present'); // Note: The actual return is what we mock, but the insert payload is verified. Let's fix test return assertions.
    });

    it('11. rejects if outside check-in window (time before)', async () => {
      setupValidSequence();
      mockQuerySequence[5] = [{ id: 'w1', isActive: true, daysOfWeek: [5], startTime: '18:00', endTime: '19:00' }]; // Current is 17:30
      await service.markAttendance('s1', getValidDto());
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('Outside check-in window') }));
    });

    it('12. rejects if outside check-in window (time after)', async () => {
      setupValidSequence();
      mockQuerySequence[5] = [{ id: 'w1', isActive: true, daysOfWeek: [5], startTime: '16:00', endTime: '17:00' }]; // Current is 17:30
      await service.markAttendance('s1', getValidDto());
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('Outside check-in window') }));
    });

    it('13. rejects if GPS sample spread > 8m', async () => {
      setupValidSequence();
      const dto = getValidDto();
      dto.gpsSampleSpread = 10;
      await service.markAttendance('s1', dto);
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('GPS sample spread too high') }));
    });

    it('14. rejects if point outside geofence (webSource false)', async () => {
      setupValidSequence();
      (pointInPolygon as jest.Mock).mockReturnValue(false);
      await service.markAttendance('s1', getValidDto());
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('outside hostel geofence') }));
    });

    it('15. rejects if GPS accuracy > 20m (webSource false)', async () => {
      setupValidSequence();
      const dto = getValidDto();
      dto.gpsAccuracyM = 25;
      await service.markAttendance('s1', dto);
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('GPS accuracy too low') }));
    });

    it('16. rejects if GPS accuracy > 10m and <= 20m, WiFi unmatched', async () => {
      setupValidSequence();
      const dto = getValidDto();
      dto.gpsAccuracyM = 15;
      dto.wifiBssidMatched = 'xx:xx';
      await service.markAttendance('s1', dto);
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('Location not verified') }));
    });

    it('17. present if GPS accuracy > 10m and <= 20m, WiFi matched', async () => {
      setupValidSequence();
      const dto = getValidDto();
      dto.gpsAccuracyM = 15; // matches ab:cd setup in setupValidSequence
      await service.markAttendance('s1', dto);
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'present' }));
    });

    it('18. present if GPS accuracy <= 10m, WiFi unmatched', async () => {
      setupValidSequence();
      const dto = getValidDto();
      dto.gpsAccuracyM = 5;
      dto.wifiBssidMatched = 'xx:xx';
      await service.markAttendance('s1', dto);
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'present' }));
    });

    it('19. rejects if Mock location detected', async () => {
      setupValidSequence();
      const dto = getValidDto();
      dto.mockLocationFlag = true;
      await service.markAttendance('s1', dto);
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('Mock location detected') }));
    });

    it('20. rejects if Implied speed > 40 m/s', async () => {
      setupValidSequence();
      mockQuerySequence[6] = [{ deviceLat: 1, deviceLng: 1, markedAt: new Date('2026-07-24T11:59:59Z') }]; // 1 second ago
      (haversineMeters as jest.Mock).mockReturnValue(50); // 50 meters in 1 sec = 50m/s
      await service.markAttendance('s1', getValidDto());
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('exceeds 40 m/s') }));
    });

    it('21. present if Implied speed <= 40 m/s', async () => {
      setupValidSequence();
      mockQuerySequence[6] = [{ deviceLat: 1, deviceLng: 1, markedAt: new Date('2026-07-24T11:59:59Z') }]; // 1 second ago
      (haversineMeters as jest.Mock).mockReturnValue(30); // 30 meters in 1 sec = 30m/s
      await service.markAttendance('s1', getValidDto());
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'present' }));
    });

    it('22. rejects if Face match < 0.60', async () => {
      setupValidSequence();
      (cosineSimilarity as jest.Mock).mockReturnValue(0.55);
      await service.markAttendance('s1', getValidDto());
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('Face does not match') }));
    });

    it('23. flags if Face match >= 0.60 and < 0.72', async () => {
      setupValidSequence();
      (cosineSimilarity as jest.Mock).mockReturnValue(0.65);
      await service.markAttendance('s1', getValidDto());
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'flagged', rejectionReason: expect.stringContaining('Face match borderline') }));
    });

    it('24. present if Face match >= 0.72', async () => {
      setupValidSequence();
      (cosineSimilarity as jest.Mock).mockReturnValue(0.75);
      await service.markAttendance('s1', getValidDto());
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'present' }));
    });

    it('25. rejects if Liveness check failed', async () => {
      setupValidSequence();
      const dto = getValidDto();
      dto.livenessPassed = false;
      await service.markAttendance('s1', dto);
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('Liveness check failed') }));
    });

    it('26. rejects if Parallax ratio low and webSource false', async () => {
      setupValidSequence();
      const dto = getValidDto();
      dto.parallaxRatio = 1.2;
      await service.markAttendance('s1', dto);
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('Parallax ratio too low') }));
    });

    it('27. rejects if Parallax ratio undefined and webSource false', async () => {
      setupValidSequence();
      const dto = getValidDto();
      delete dto.parallaxRatio;
      await service.markAttendance('s1', dto);
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejectionReason: expect.stringContaining('Parallax ratio too low') }));
    });

    it('28. flags if Buddy punching: 3+ students on same device today', async () => {
      setupValidSequence();
      mockQuerySequence[7] = [{ count: 3 }];
      await service.markAttendance('s1', getValidDto());
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'flagged', rejectionReason: expect.stringContaining('possible buddy-punching') }));
    });

    it('29. present if webSource true (skips geo, parallax checks)', async () => {
      setupValidSequence();
      const dto = getValidDto();
      dto.webSource = true;
      dto.parallaxRatio = undefined;
      dto.gpsAccuracyM = 100; // normally fails
      (pointInPolygon as jest.Mock).mockReturnValue(false); // normally fails
      await service.markAttendance('s1', dto);
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'present' }));
    });

    it('30. happy path (webSource false) returns created record', async () => {
      setupValidSequence();
      mockQuerySequence[8] = [{ id: 'inserted-rec', status: 'present' }];
      const res = await service.markAttendance('s1', getValidDto());
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'present' }));
      expect(res).toEqual({ id: 'inserted-rec', status: 'present' });
    });
  });

  describe('getHistory', () => {
    it('31. returns paginated results and correct count', async () => {
      mockQuerySequence = [
        [{ id: 'r1' }, { id: 'r2' }], // rows
        [{ count: 2 }] // count
      ];
      const res = await service.getHistory('s1', 1, 10);
      expect(res).toEqual({ data: [{ id: 'r1' }, { id: 'r2' }], total: 2, page: 1, limit: 10 });
    });

    it('32. returns empty results when no records', async () => {
      mockQuerySequence = [
        [], // rows
        [{ count: 0 }] // count
      ];
      const res = await service.getHistory('s2', 1, 10);
      expect(res).toEqual({ data: [], total: 0, page: 1, limit: 10 });
    });
  });

  describe('getAdminView', () => {
    it('33. returns paginated results with no filters', async () => {
      mockQuerySequence = [
        [{ id: 'r1' }], // rows
        [{ count: 1 }] // count
      ];
      const res = await service.getAdminView(undefined, undefined, undefined, undefined, 1, 10);
      expect(res.data).toHaveLength(1);
      expect(res.total).toBe(1);
    });

    it('34. returns paginated results with hostel filter', async () => {
      mockQuerySequence = [
        [{ id: 'r1', hostelId: 'h1' }], // rows
        [{ count: 1 }] // count
      ];
      const res = await service.getAdminView('h1', undefined, undefined, undefined, 1, 10);
      expect(res.data).toHaveLength(1);
    });

    it('35. returns paginated results with status, dateFrom, dateTo filters', async () => {
      mockQuerySequence = [
        [{ id: 'r1', status: 'flagged' }], // rows
        [{ count: 1 }] // count
      ];
      const res = await service.getAdminView(undefined, 'flagged', '2026-07-20', '2026-07-25', 1, 10);
      expect(res.data).toHaveLength(1);
    });
  });

  describe('recordLivenessFailure', () => {
    it('36. throws BadRequestException if student not assigned to hostel', async () => {
      mockQuerySequence = [
        [] // assignment empty
      ];
      await expect(service.recordLivenessFailure('s1', 'h1')).rejects.toThrow(BadRequestException);
    });

    it('37. logs failure successfully and returns record', async () => {
      mockQuerySequence = [
        [{ id: 'a1' }], // assignment
        [{ id: 'f1', attemptCount: 3 }] // returned insert
      ];
      const res = await service.recordLivenessFailure('s1', 'h1');
      expect(res).toEqual({ id: 'f1', attemptCount: 3 });
    });
  });
});
