import { fetchWithAuth, setToken } from "./auth";

// ── Types ──────────────────────────────────────────────────
export interface DashboardStats {
  totalStudents: number;
  boysHostelCount: number;
  girlsHostelCount: number;
  pendingEnrollments: number;
  todayAttendancePercent: number;
}

export interface Hostel {
  id: string;
  name: string;
  type: "boys" | "girls";
  collegeName: string;
  wifiBssids: string[];
  boundaryPolygon: string | null; // GeoJSON string
  createdAt: string;
}

export interface CheckInWindow {
  id: string;
  hostelId: string;
  name: string;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  daysOfWeek: number[]; // 0=Sun..6=Sat
  isActive: boolean;
  createdAt: string;
}

export interface Student {
  id: string;
  name: string;
  rollNumber: string;
  email: string;
  hostelId: string | null;
  hostelName: string | null;
  createdAt: string;
}

export interface Enrollment {
  id: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
}

export interface AttendanceRecord {
  id: string;
  studentName: string;
  rollNumber: string;
  hostelName: string;
  time: string;
  faceScore: number;
  livenessScore: number;
  locationVerified: boolean;
  status: "present" | "rejected" | "flagged";
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ── API error handling ─────────────────────────────────────
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message || res.statusText);
  }
  return res.json();
}

// ── Auth ───────────────────────────────────────────────────
export async function login(
  email: string,
  password: string
): Promise<{ token: string; user: { name: string; email: string } }> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"}/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }
  );
  const data = await handleResponse<{
    token: string;
    user: { name: string; email: string };
  }>(res);
  setToken(data.token);
  return data;
}

// ── Dashboard ──────────────────────────────────────────────
export async function getDashboardStats(): Promise<DashboardStats> {
  const res = await fetchWithAuth("/admin/dashboard/stats");
  return handleResponse(res);
}

// ── Hostels ────────────────────────────────────────────────
export async function getHostels(): Promise<Hostel[]> {
  const res = await fetchWithAuth("/admin/hostels");
  const paginated = await handleResponse<PaginatedResponse<Hostel>>(res);
  return paginated.data;
}

export async function createHostel(data: {
  name: string;
  type: "boys" | "girls";
  collegeName: string;
  wifiBssids: string[];
  boundaryPolygon: string;
}): Promise<Hostel> {
  const res = await fetchWithAuth("/hostel", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateHostel(
  id: string,
  data: Partial<{
    name: string;
    type: "boys" | "girls";
    collegeName: string;
    wifiBssids: string[];
    boundaryPolygon: string;
  }>
): Promise<Hostel> {
  const res = await fetchWithAuth(`/hostel/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteHostel(id: string): Promise<void> {
  const res = await fetchWithAuth(`/hostel/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Delete failed" }));
    throw new ApiError(res.status, body.message);
  }
}

// ── Check-in Windows ───────────────────────────────────────
export async function getWindows(hostelId: string): Promise<CheckInWindow[]> {
  const res = await fetchWithAuth(`/hostel/${hostelId}/windows`);
  return handleResponse(res);
}

export async function createWindow(
  hostelId: string,
  data: {
    name: string;
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    isActive?: boolean;
  }
): Promise<CheckInWindow> {
  const res = await fetchWithAuth(`/hostel/${hostelId}/windows`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function updateWindow(
  hostelId: string,
  windowId: string,
  data: Partial<{ name: string; startTime: string; endTime: string; daysOfWeek: number[]; isActive: boolean }>
): Promise<CheckInWindow> {
  const res = await fetchWithAuth(`/hostel/${hostelId}/windows/${windowId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function deleteWindow(
  hostelId: string,
  windowId: string
): Promise<void> {
  const res = await fetchWithAuth(`/hostel/${hostelId}/windows/${windowId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Delete failed" }));
    throw new ApiError(res.status, body.message);
  }
}

// ── Enrollments ────────────────────────────────────────────
export async function getEnrollments(params: {
  status?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<Enrollment>> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  q.set("page", String(params.page || 1));
  q.set("limit", String(params.limit || 20));
  const res = await fetchWithAuth(`/admin/enrollments?${q}`);
  return handleResponse(res);
}

export async function approveEnrollment(id: string): Promise<void> {
  const res = await fetchWithAuth(`/admin/enrollments/${id}/approve`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Approve failed" }));
    throw new ApiError(res.status, body.message);
  }
}

export async function rejectEnrollment(id: string): Promise<void> {
  const res = await fetchWithAuth(`/admin/enrollments/${id}/reject`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Reject failed" }));
    throw new ApiError(res.status, body.message);
  }
}

// ── Attendance ─────────────────────────────────────────────
export async function getAttendance(params: {
  hostelId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<AttendanceRecord>> {
  const q = new URLSearchParams();
  if (params.hostelId) q.set("hostelId", params.hostelId);
  if (params.status) q.set("status", params.status);
  if (params.dateFrom) q.set("dateFrom", params.dateFrom);
  if (params.dateTo) q.set("dateTo", params.dateTo);
  q.set("page", String(params.page || 1));
  q.set("limit", String(params.limit || 20));
  const res = await fetchWithAuth(`/admin/attendance?${q}`);
  return handleResponse(res);
}

// ── Students ───────────────────────────────────────────────
export async function getStudents(params: {
  hostelId?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<Student>> {
  const q = new URLSearchParams();
  if (params.hostelId) q.set("hostelId", params.hostelId);
  q.set("page", String(params.page || 1));
  q.set("limit", String(params.limit || 20));
  const res = await fetchWithAuth(`/admin/students?${q}`);
  return handleResponse(res);
}

export async function assignStudentHostel(
  studentId: string,
  hostelId: string | null
): Promise<void> {
  const res = await fetchWithAuth(`/admin/students/${studentId}/assign`, {
    method: "POST",
    body: JSON.stringify({ hostelId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: "Assign failed" }));
    throw new ApiError(res.status, body.message);
  }
}
