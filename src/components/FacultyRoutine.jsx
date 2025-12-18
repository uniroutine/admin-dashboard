// src/components/FacultyRoutine.jsx
import React, { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { db } from "../firebase";
import {
    collection,
    getDocs,
    doc,
    getDoc,
    setDoc
} from "firebase/firestore";
import "./FacultyRoutine.css";

/*
 *  FacultyRoutine
 *
 *  Behavior:
 *    - Loads list of teachers (prefers scanning subjects/{}/teachers).
 *    - When a teacher is chosen it scans all routines and their day subcollections
 *      (mon, tue, wed, thu, fri) and collects every period where teacherId === chosen id.
 *    - Renders a table with rows=days, columns=period/time slots.
 *    - Shows weekly load summary with Theory/Lab split and supports a user-configurable
 *      load limit saved to that teacher's Firestore document. Warns if the teacher exceeds the set limit.
 */

const daysToFetch = ["mon", "tue", "wed", "thu", "fri"];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

const timeSlots = [
    { period: 1, time: "9:00 - 10:00" },
{ period: 2, time: "10:00 - 11:00" },
{ period: 3, time: "11:00 - 12:00" },
{ period: 4, time: "12:00 - 1:00", isLunch: true },
{ period: 5, time: "1:00 - 2:00" },
{ period: 6, time: "2:00 - 3:00" },
{ period: 7, time: "3:00 - 4:00" },
{ period: 8, time: "4:00 - 5:00" },
];

function FacultyRoutine() {
    const [teachers, setTeachers] = useState([]); // { id, name }
    const [loadingTeachers, setLoadingTeachers] = useState(true);
    const [selectedTeacher, setSelectedTeacher] = useState(null);

    const [loadingSchedule, setLoadingSchedule] = useState(false);
    // structure: { dayKey: { periodNumber: [ { routineId, routineName, subject, subjectCode, room } ] } }
    const [teacherSchedule, setTeacherSchedule] = useState({});

    const [error, setError] = useState(null);

    // Load teachers by scanning subjects/*/teachers (preferred fallback)
    useEffect(() => {
        const loadTeachers = async () => {
            setLoadingTeachers(true);
            setError(null);
            try {
                const subjectsSnapshot = await getDocs(collection(db, "subjects"));
                const teacherMap = {};
                for (const subDoc of subjectsSnapshot.docs) {
                    const teachersRef = collection(db, "subjects", subDoc.id, "teachers");
                    const tSnap = await getDocs(teachersRef);
                    tSnap.forEach((t) => {
                        teacherMap[t.id] = t.data().name || t.id;
                    });
                }
                const fallbackList = Object.entries(teacherMap).map(([id, name]) => ({
                    id,
                    name,
                }));
                setTeachers(fallbackList);
            } catch (err) {
                console.error("Failed loading teachers:", err);
                setError("Failed loading teachers.");
            } finally {
                setLoadingTeachers(false);
            }
        };

        loadTeachers();
    }, []);

    // Helper: teacher select options for react-select
    const teacherOptions = useMemo(
        () => teachers.map((t) => ({ value: t.id, label: t.name })),
                                   [teachers]
    );

    // When a teacher is chosen, scan all routines and gather their assignments
    useEffect(() => {
        if (!selectedTeacher) {
            setTeacherSchedule({});
            return;
        }

        let cancelled = false;
        const loadTeacherAssignments = async (teacherId) => {
            setLoadingSchedule(true);
            setError(null);
            try {
                const scheduleMap = {}; // dayKey -> period -> array

                // Fetch all routines once
                const routinesSnapshot = await getDocs(collection(db, "routines"));
                if (routinesSnapshot.empty) {
                    setTeacherSchedule({});
                    return;
                }

                // For each routine, fetch each day subcollection and check periods
                const routineDocs = routinesSnapshot.docs.map((d) => ({
                    id: d.id,
                    name: d.data().name || d.id,
                }));

                // iterate routines
                for (const r of routineDocs) {
                    // For better responsiveness: bail if user switched teacher
                    if (cancelled) return;

                    for (const dayKey of daysToFetch) {
                        if (cancelled) return;

                        const dayRef = collection(db, "routines", r.id, dayKey);
                        const daySnapshot = await getDocs(dayRef); // small subcollections -> OK
                        if (daySnapshot.empty) continue;

                        daySnapshot.forEach((periodDoc) => {
                            const p = Number(periodDoc.id);
                            const data = periodDoc.data();
                            if (!data) return;
                            const tId = data.teacherId || data.teacher || data.facultyId || null;
                            if (!tId) return;
                            // If teacher id stored as name string rather than id, we also check match against label (best-effort)
                            if (tId === teacherId || (typeof data.tname === "string" && data.tname === teacherId)) {
                                if (!scheduleMap[dayKey]) scheduleMap[dayKey] = {};
                                if (!scheduleMap[dayKey][p]) scheduleMap[dayKey][p] = [];
                                scheduleMap[dayKey][p].push({
                                    routineId: r.id,
                                    routineName: r.name,
                                    subject: data.sname || data.subject || data.name || "",
                                    subjectCode: data.scode || data.code || "",
                                    room: data.room || data.venue || "",
                                });
                            }
                        });
                    }
                }

                if (!cancelled) setTeacherSchedule(scheduleMap);
            } catch (err) {
                console.error("Error loading teacher schedule:", err);
                if (!cancelled) setError("Failed to load schedule.");
            } finally {
                if (!cancelled) setLoadingSchedule(false);
            }
        };

        loadTeacherAssignments(selectedTeacher.value);
        return () => {
            cancelled = true;
        };
    }, [selectedTeacher]);

    // Helpers to query a cell
    const getCellEntries = (dayKey, periodNum) => {
        return (teacherSchedule[dayKey] && teacherSchedule[dayKey][periodNum]) || [];
    };

    // ---------- Weekly load calculation ----------
    // Theory classes count as 1, Lab classes count as 0.5
    // A class is considered Lab if its subject name contains the substring "lab" (case-insensitive)
    const calculateWeeklyLoad = () => {
        let theoryCount = 0;
        let labCount = 0;

        Object.values(teacherSchedule).forEach((dayObj) => {
            Object.values(dayObj).forEach((entries) => {
                entries.forEach((entry) => {
                    const subjectName = entry.subject || "";

                    // Matches: lab, Lab, LAB, laboratory, Laboratory, etc.
                    const isLab = /\blab\b|\blaboratory\b/i.test(subjectName);

                    if (isLab) {
                        labCount += 1;
                    } else {
                        theoryCount += 1;
                    }
                });
            });
        });

        const totalLoad = Number((theoryCount + labCount * 0.5).toFixed(2));
        return { theoryCount, labCount, totalLoad };
    };

    // ---------- Load limit UI stored in Firestore ----------
    // Store the limit per-teacher in the `teachers/{teacherId}` document as `loadLimit` (number).
    // If the teachers collection/doc doesn't exist we create it with merge.

    const [limitModalOpen, setLimitModalOpen] = useState(false);
    const [limitInputValue, setLimitInputValue] = useState(""); // string for controlled input
    const [loadLimit, setLoadLimit] = useState(null); // number or null
    const [limitLoading, setLimitLoading] = useState(false);
    const [limitSaving, setLimitSaving] = useState(false);

    // Load saved limit when selectedTeacher changes — read from Firestore teachers/{id}
    useEffect(() => {
        if (!selectedTeacher) {
            setLoadLimit(null);
            setLimitInputValue("");
            return;
        }

        let cancelled = false;
        const fetchLimit = async () => {
            setLimitLoading(true);
            try {
                const docRef = doc(db, "teachers", selectedTeacher.value);
                const snap = await getDoc(docRef);
                if (!cancelled) {
                    if (snap.exists()) {
                        const data = snap.data();
                        if (data && typeof data.loadLimit === "number") {
                            setLoadLimit(data.loadLimit);
                            setLimitInputValue(String(data.loadLimit));
                        } else {
                            setLoadLimit(null);
                            setLimitInputValue("");
                        }
                    } else {
                        setLoadLimit(null);
                        setLimitInputValue("");
                    }
                }
            } catch (err) {
                console.error("Error fetching teacher load limit:", err);
            } finally {
                if (!cancelled) setLimitLoading(false);
            }
        };

        fetchLimit();
        return () => {
            cancelled = true;
        };
    }, [selectedTeacher]);

    const openLimitDialog = () => {
        setLimitInputValue(loadLimit !== null ? String(loadLimit) : "");
        setLimitModalOpen(true);
    };

    const saveLimit = async () => {
        if (!selectedTeacher) return;
        setLimitSaving(true);
        try {
            const parsed = Number(limitInputValue);
            const teacherDocRef = doc(db, "teachers", selectedTeacher.value);

            if (limitInputValue === "" || Number.isNaN(parsed) || parsed <= 0) {
                // clear the limit (set to null)
                await setDoc(
                    teacherDocRef,
                    { loadLimit: null, name: selectedTeacher.label },
                    { merge: true }
                );
                setLoadLimit(null);
            } else {
                await setDoc(
                    teacherDocRef,
                    { loadLimit: parsed, name: selectedTeacher.label },
                    { merge: true }
                );
                setLoadLimit(parsed);
            }
        } catch (err) {
            console.error("Error saving teacher load limit:", err);
        } finally {
            setLimitSaving(false);
            setLimitModalOpen(false);
        }
    };

    const clearLimit = async () => {
        if (!selectedTeacher) return;
        setLimitSaving(true);
        try {
            const teacherDocRef = doc(db, "teachers", selectedTeacher.value);
            await setDoc(teacherDocRef, { loadLimit: null, name: selectedTeacher.label }, { merge: true });
            setLoadLimit(null);
            setLimitInputValue("");
        } catch (err) {
            console.error("Error clearing teacher load limit:", err);
        } finally {
            setLimitSaving(false);
            setLimitModalOpen(false);
        }
    };

    // Format number for display (show .0 if integer)
    const fmt = (n) => {
        if (n === null || n === undefined) return "-";
        if (Number.isInteger(n)) return String(n);
        return String(n % 1 === 0 ? n.toFixed(0) : n.toFixed(2));
    };

    // ---------- Render ----------
    const { theoryCount, labCount, totalLoad } = calculateWeeklyLoad();
    const exceedsLimit = loadLimit !== null && totalLoad > loadLimit;

    return (
        <div className="faculty-container">
        <h2>Faculty Routine</h2>
        <p className="muted">Choose a teacher to see their classes for the week.</p>

        <div className="teacher-selector">
        <label>Teacher</label>
        <Select
        options={teacherOptions}
        value={selectedTeacher}
        onChange={(opt) => setSelectedTeacher(opt)}
        isLoading={loadingTeachers}
        placeholder={loadingTeachers ? "Loading teachers..." : "Select teacher..."}
        isClearable
        />
        </div>

        {error && <div className="feedback-error small">{error}</div>}

        {selectedTeacher && (
            <>
            <div className="faculty-top-row">
            <h3 className="table-title small">
            {selectedTeacher.label} — Weekly View
            </h3>

            <div className="faculty-actions">
            <button
            className={`btn-set-limit ${limitLoading ? "disabled" : ""}`}
            onClick={openLimitDialog}
            title="Set weekly load limit"
            disabled={limitLoading}
            >
            Set Load Limit
            </button>
            </div>
            </div>

            {/* Load summary */}
            <div className={`faculty-load-summary ${exceedsLimit ? "over-limit" : ""}`}>
            <div className="load-item">
            <strong>Total Weekly Load:</strong>{" "}
            <span className="load-value">{fmt(totalLoad)}</span>
            </div>
            <div className="load-item">
            <strong>Theory Classes:</strong>{" "}
            <span className="load-value">{theoryCount}</span>
            </div>
            <div className="load-item">
            <strong>Lab Classes:</strong>{" "}
            <span className="load-value">
            {labCount} <span className="load-muted">(counts as {fmt(labCount * 0.5)})</span>
            </span>
            </div>

            <div className="limit-item">
            <strong>Limit:</strong>{" "}
            <span className="load-value">{loadLimit !== null ? fmt(loadLimit) : "Not set"}</span>
            {loadLimit !== null && (
                <button
                className="btn-clear-limit"
                onClick={async () => {
                    // clear via Firestore
                    await clearLimit();
                }}
                disabled={limitSaving}
                >
                Clear
                </button>
            )}
            </div>
            </div>

            {exceedsLimit && (
                <div className="load-warning">
                <strong>Warning:</strong> {selectedTeacher.label} exceeds the weekly load limit by{" "}
                <span className="warn-value">{fmt(totalLoad - loadLimit)}</span>.
                </div>
            )}

            {loadingSchedule ? (
                <div className="loading-box">Loading assignments…</div>
            ) : (
                <div className="table-wrapper faculty-wrapper">
                <table className="routine-table faculty-table">
                <thead>
                <tr>
                <th className="day-column">Day / Time</th>
                {timeSlots.map((slot, idx) => (
                    <th key={idx} className={slot.isLunch ? "lunch-header" : "period-header"}>
                    {slot.time}
                    </th>
                ))}
                </tr>
                </thead>

                <tbody>
                {days.map((day, dayIdx) => {
                    const dayKey = day.toLowerCase().substring(0, 3);
                    return (
                        <tr key={dayIdx}>
                        <td className="day-cell">
                        <div className="day-name">{day}</div>
                        </td>

                        {timeSlots.map((slot, sIdx) => {
                            if (slot.isLunch) {
                                return (
                                    <td key={sIdx} className="lunch-cell">
                                    <div className="lunch-content">
                                    <span className="lunch-text">Lunch Break</span>
                                    </div>
                                    </td>
                                );
                            }

                            const entries = getCellEntries(dayKey, slot.period);

                            return (
                                <td key={sIdx} className="subject-cell faculty-cell">
                                {entries.length === 0 ? (
                                    <div className="cell-empty">—</div>
                                ) : (
                                    <div className="faculty-cell-list">
                                    {entries.map((e, i) => (
                                        <div key={`${e.routineId}-${i}`} className="faculty-entry">
                                        <div className="faculty-entry-top">
                                        <span className="faculty-routine">{e.routineName}</span>
                                        {e.subjectCode && (
                                            <span className="faculty-subcode">[{e.subjectCode}]</span>
                                        )}
                                        </div>
                                        <div className="faculty-subject">{e.subject}</div>
                                        {e.room && <div className="room-name">Room: {e.room}</div>}
                                        </div>
                                    ))}
                                    </div>
                                )}
                                </td>
                            );
                        })}
                        </tr>
                    );
                })}
                </tbody>
                </table>
                </div>
            )}

            <div className="info-footer">
            <p>Data pulled from the `routines` collection in Firestore.</p>
            </div>
            </>
        )}

        {!selectedTeacher && (
            <div className="no-selection small">
            <h4>Select a teacher to view their weekly assignments</h4>
            </div>
        )}

        {/* Limit dialog */}
        {limitModalOpen && selectedTeacher && (
            <div className="modal-overlay" onMouseDown={() => setLimitModalOpen(false)}>
            <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <h4>Set Weekly Load Limit</h4>
            <p className="modal-sub">Set a numeric weekly load limit for <strong>{selectedTeacher.label}</strong>.</p>

            <div className="modal-body">
            <label className="modal-label">Limit (use decimals for halves, e.g. 12.5)</label>
            <input
            type="number"
            step="0.5"
            min="0"
            value={limitInputValue}
            onChange={(e) => setLimitInputValue(e.target.value)}
            className="modal-input"
            placeholder="e.g. 12.5"
            />
            <p className="modal-note">Theory classes count as 1. Lab classes count as 0.5.</p>
            </div>

            <div className="modal-actions">
            <button className="btn-primary" onClick={saveLimit} disabled={limitSaving}>
            {limitSaving ? "Saving..." : "Save"}
            </button>
            <button className="btn-secondary" onClick={() => setLimitModalOpen(false)} disabled={limitSaving}>Cancel</button>
            <button className="btn-link" onClick={clearLimit} disabled={limitSaving}>Clear</button>
            </div>
            </div>
            </div>
        )}
        </div>
    );
}

export default FacultyRoutine;
