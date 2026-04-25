// src/components/FacultyRoutine.jsx
import React, { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { db } from "../firebase";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import "./FacultyRoutine.css";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

const timeSlots = [
    { period: 1, time: "9:00 - 9:50" },
    { period: 2, time: "9:50 - 10:40" },
    { period: 3, time: "10:40 - 11:30" },
    { period: 4, time: "11:30 - 12:20" },
    { period: 5, time: "12:20 - 1:00", isLunch: true },
    { period: 6, time: "1:00 - 1:50" },
    { period: 7, time: "1:50 - 2:40" },
    { period: 8, time: "2:40 - 3:30" },
    { period: 9, time: "3:30 - 4:20" }
];

function getDesignationInfo(teacherName = "") {
    const n = teacherName.toLowerCase();
    if (n.includes("asst.") || n.includes("assistant")) return { label: "Assistant Professor", limit: 24 };
    if (n.includes("assoc.") || n.includes("associate")) return { label: "Associate Professor", limit: 12 };
    if (n.includes("prof.") || n.includes("professor")) return { label: "Professor", limit: 8 };
    return { label: "Associate Professor (default)", limit: 12 };
}

function FacultyRoutine() {
    const [teachers, setTeachers] = useState([]);
    const [loadingTeachers, setLoadingTeachers] = useState(true);
    const [selectedTeacher, setSelectedTeacher] = useState(null);
    const [loadingSchedule, setLoadingSchedule] = useState(false);
    const [teacherSchedule, setTeacherSchedule] = useState({});
    const [loadInfo, setLoadInfo] = useState(null);
    const [error, setError] = useState(null);

    // Load teachers from Faculty_Routine instead of subjects
    useEffect(() => {
        const loadTeachers = async () => {
            setLoadingTeachers(true);
            setError(null);
            try {
                const snap = await getDocs(collection(db, "Faculty_Routine"));
                const list = snap.docs.map(d => ({
                    id: d.id,
                    name: d.data().teacherName || d.id
                }));
                setTeachers(list);
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

    // Load schedule from Faculty_Routine/{teacherId}/slots
    useEffect(() => {
        if (!selectedTeacher) { setTeacherSchedule({}); setLoadInfo(null); return; }

        const load = async (teacherId) => {
            setLoadingSchedule(true);
            setError(null);
            try {
                // Get parent doc for load info
                const teacherDocSnap = await getDoc(doc(db, "Faculty_Routine", teacherId));
                if (teacherDocSnap.exists()) {
                    setLoadInfo(teacherDocSnap.data());
                }

                // Get all slots
                const slotsSnap = await getDocs(
                    collection(db, "Faculty_Routine", teacherId, "slots")
                );

                // Build scheduleMap: { dayKey: { period: slotData } }
                const scheduleMap = {};
                slotsSnap.forEach((slotDoc) => {
                    const data = slotDoc.data();
                    const dayKey = data.day;
                    const period = data.period;
                    if (!scheduleMap[dayKey]) scheduleMap[dayKey] = {};
                    scheduleMap[dayKey][period] = {
                        className: data.className,
                        subject: data.subjectName || '',
                        subjectCode: data.subjectCode || '',
                        teacherName: data.teacherName,
                        load: data.load
                    };
                });

                setTeacherSchedule(scheduleMap);
            } catch (err) {
                setError("Failed to load schedule.");
            } finally {
                setLoadingSchedule(false);
            }
        };

        load(selectedTeacher.value);
    }, [selectedTeacher]);

    const getCellEntry = (dayKey, periodNum) =>
        teacherSchedule[dayKey]?.[periodNum] || null;

    const fmt = (n) => (n % 1 === 0 ? String(n) : n.toFixed(2));

    const designationInfo = selectedTeacher
        ? getDesignationInfo(selectedTeacher.label)
        : null;

    const maxLoad = loadInfo?.maxLoad ?? designationInfo?.limit ?? 0;
    const remainingLoad = loadInfo?.remainingLoad ?? maxLoad;
    const totalLoad = Number((maxLoad - remainingLoad).toFixed(2));
    const exceedsLimit = totalLoad > maxLoad;

    // Count theory and lab from slots
    let theoryCount = 0;
    let labCount = 0;
    Object.values(teacherSchedule).forEach((dayObj) => {
        Object.values(dayObj).forEach((entry) => {
            if (entry.load === 1.0) labCount += 1;
            else theoryCount += 1;
        });
    });

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

                    {loadInfo && (
                        <div className={`faculty-load-summary ${exceedsLimit ? "over-limit" : ""}`}>
                            <div className="load-item">
                                <strong>Designation:</strong>{" "}
                                <span className="load-value">{designationInfo.label}</span>
                            </div>
                            <div className="load-item">
                                <strong>Load Limit:</strong>{" "}
                                <span className="load-value">{maxLoad}</span>
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
                                <span className="load-value">{fmt(totalLoad)} / {maxLoad}</span>
                            </div>
                            <div className="load-item">
                                <strong>Remaining:</strong>{" "}
                                <span className="load-value">{fmt(remainingLoad)}</span>
                            </div>
                        </div>
                    )}

                    {exceedsLimit && (
                        <div className="load-warning">
                            <strong>Warning:</strong> {selectedTeacher.label} exceeds the load limit by{" "}
                            <span className="warn-value">{fmt(totalLoad - maxLoad)}</span>.
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
                                                    const entry = getCellEntry(dayKey, slot.period);
                                                    return (
                                                        <td key={sIdx} className="subject-cell faculty-cell">
                                                            {!entry ? (
                                                                <div className="cell-empty">—</div>
                                                            ) : (
                                                                <div className="faculty-entry">
                                                                    <div className="faculty-entry-top">
                                                                        <span className="faculty-routine">{entry.className}</span>
                                                                        {entry.subjectCode && (
                                                                            <span className="faculty-subcode">[{entry.subjectCode}]</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="faculty-subject">{entry.subject}</div>
                                                                    <div className="faculty-load-tag">
                                                                        {entry.load === 1.0 ? 'Lab' : 'Theory'}
                                                                    </div>
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
                        <p>Data pulled from Faculty_Routine collection.</p>
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