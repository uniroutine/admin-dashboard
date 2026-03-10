// src/components/FacultyRoutine.jsx
import React, { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { db } from "../firebase";
import {
    collection,
    getDocs,
} from "firebase/firestore";
import "./FacultyRoutine.css";

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

// Detects designation from teacher name → returns label + load limit
// No designation found → defaults to Associate Professor (limit 12)
function getDesignationInfo(teacherName = "") {
    const n = teacherName.toLowerCase();
    if (n.includes("asst.") || n.includes("assistant")) {
        return { label: "Assistant Professor", limit: 24 };
    }
    if (n.includes("assoc.") || n.includes("associate")) {
        return { label: "Associate Professor", limit: 12 };
    }
    if (n.includes("prof.") || n.includes("professor")) {
        return { label: "Professor", limit: 8 };
    }
    return { label: "Associate Professor (default)", limit: 12 };
}

function FacultyRoutine() {
    const [teachers, setTeachers] = useState([]);
    const [loadingTeachers, setLoadingTeachers] = useState(true);
    const [selectedTeacher, setSelectedTeacher] = useState(null);

    const [loadingSchedule, setLoadingSchedule] = useState(false);
    const [teacherSchedule, setTeacherSchedule] = useState({});

    const [error, setError] = useState(null);

    useEffect(() => {
        const loadTeachers = async () => {
            setLoadingTeachers(true);
            setError(null);
            try {
                const subjectsSnapshot = await getDocs(collection(db, "subjects"));
                const teacherMap = {};
                for (const subDoc of subjectsSnapshot.docs) {
                    const tSnap = await getDocs(collection(db, "subjects", subDoc.id, "teachers"));
                    tSnap.forEach((t) => {
                        teacherMap[t.id] = t.data().name || t.id;
                    });
                }
                setTeachers(Object.entries(teacherMap).map(([id, name]) => ({ id, name })));
            } catch (err) {
                setError("Failed loading teachers.");
            } finally {
                setLoadingTeachers(false);
            }
        };
        loadTeachers();
    }, []);

    const teacherOptions = useMemo(
        () => teachers.map((t) => ({ value: t.id, label: t.name })),
        [teachers]
    );

    useEffect(() => {
        if (!selectedTeacher) { setTeacherSchedule({}); return; }

        let cancelled = false;
        const load = async (teacherId) => {
            setLoadingSchedule(true);
            setError(null);
            try {
                const scheduleMap = {};
                const routinesSnapshot = await getDocs(collection(db, "routines"));
                if (routinesSnapshot.empty) { setTeacherSchedule({}); return; }

                const routineDocs = routinesSnapshot.docs.map((d) => ({
                    id: d.id,
                    name: d.data().name || d.id,
                }));

                for (const r of routineDocs) {
                    if (cancelled) return;
                    for (const dayKey of daysToFetch) {
                        if (cancelled) return;
                        const daySnapshot = await getDocs(collection(db, "routines", r.id, dayKey));
                        if (daySnapshot.empty) continue;

                        daySnapshot.forEach((periodDoc) => {
                            const p = Number(periodDoc.id);
                            const data = periodDoc.data();
                            if (!data) return;
                            const tId = data.teacherId || data.teacher || data.facultyId || null;
                            if (!tId || tId !== teacherId) return;

                            if (!scheduleMap[dayKey]) scheduleMap[dayKey] = {};
                            if (!scheduleMap[dayKey][p]) scheduleMap[dayKey][p] = [];
                            scheduleMap[dayKey][p].push({
                                routineId: r.id,
                                routineName: r.name,
                                subject: data.sname || data.subject || data.name || "",
                                subjectCode: data.scode || data.code || "",
                                room: data.room || data.venue || "",
                            });
                        });
                    }
                }
                if (!cancelled) setTeacherSchedule(scheduleMap);
            } catch (err) {
                if (!cancelled) setError("Failed to load schedule.");
            } finally {
                if (!cancelled) setLoadingSchedule(false);
            }
        };

        load(selectedTeacher.value);
        return () => { cancelled = true; };
    }, [selectedTeacher]);

    const getCellEntries = (dayKey, periodNum) =>
        (teacherSchedule[dayKey] && teacherSchedule[dayKey][periodNum]) || [];

    // Theory = 1.5 per class, Lab = 1 per class
    const calculateWeeklyLoad = () => {
        let theoryCount = 0;
        let labCount = 0;
        Object.values(teacherSchedule).forEach((dayObj) => {
            Object.values(dayObj).forEach((entries) => {
                entries.forEach((entry) => {
                    const isLab = /\blab\b|\blaboratory\b/i.test(entry.subject || "");
                    if (isLab) labCount += 1;
                    else theoryCount += 1;
                });
            });
        });
        const totalLoad = Number((theoryCount * 1.5 + labCount * 1).toFixed(2));
        return { theoryCount, labCount, totalLoad };
    };

    const fmt = (n) => (n % 1 === 0 ? String(n) : n.toFixed(2));

    const { theoryCount, labCount, totalLoad } = calculateWeeklyLoad();
    const designationInfo = selectedTeacher ? getDesignationInfo(selectedTeacher.label) : null;
    const exceedsLimit = designationInfo && totalLoad > designationInfo.limit;

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
                    <h3 className="table-title small">{selectedTeacher.label} — Weekly View</h3>

                    <div className={`faculty-load-summary ${exceedsLimit ? "over-limit" : ""}`}>
                        <div className="load-item">
                            <strong>Designation:</strong>{" "}
                            <span className="load-value">{designationInfo.label}</span>
                        </div>
                        <div className="load-item">
                            <strong>Load Limit:</strong>{" "}
                            <span className="load-value">{designationInfo.limit}</span>
                        </div>
                        <div className="load-item">
                            <strong>Theory:</strong>{" "}
                            <span className="load-value">{theoryCount} × 1.5 = {fmt(theoryCount * 1.5)}</span>
                        </div>
                        <div className="load-item">
                            <strong>Lab:</strong>{" "}
                            <span className="load-value">{labCount} × 1 = {fmt(labCount)}</span>
                        </div>
                        <div className="load-item">
                            <strong>Total Load:</strong>{" "}
                            <span className="load-value">{fmt(totalLoad)} / {designationInfo.limit}</span>
                        </div>
                    </div>

                    {exceedsLimit && (
                        <div className="load-warning">
                            <strong>Warning:</strong> {selectedTeacher.label} exceeds the load limit by{" "}
                            <span className="warn-value">{fmt(totalLoad - designationInfo.limit)}</span>.
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
        </div>
    );
}

export default FacultyRoutine;