import React, { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { db } from "../firebase";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { 
  TIME_SLOTS, 
  GENERATOR_DAYS, 
  DAY_LABELS, 
  getDesignationLimit, 
  getDesignationInfo 
} from "./routineUtils";
import "./FacultyRoutine.css";

function FacultyRoutine() {
  const [teachers, setTeachers] = useState([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [selectedTeacher, setSelectedTeacher] = useState(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [teacherSchedule, setTeacherSchedule] = useState({});
  const [loadInfo, setLoadInfo] = useState(null);
  const [error, setError] = useState(null);

  // Load teachers from Faculty_Routine
  useEffect(() => {
    const loadTeachers = async () => {
      setLoadingTeachers(true);
      setError(null);
      try {
        const snap = await getDocs(collection(db, "Faculty_Routine"));
        setTeachers(snap.docs.map(d => ({
          id: d.id,
          name: d.data().teacherName || d.id
        })));
      } catch {
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
        const teacherDocSnap = await getDoc(doc(db, "Faculty_Routine", teacherId));
        if (teacherDocSnap.exists()) setLoadInfo(teacherDocSnap.data());

        const slotsSnap = await getDocs(collection(db, "Faculty_Routine", teacherId, "slots"));
        const scheduleMap = {};
        
        slotsSnap.forEach((slotDoc) => {
          const data = slotDoc.data();
          if (!scheduleMap[data.day]) scheduleMap[data.day] = {};
          scheduleMap[data.day][data.period] = {
            className: data.routineName || data.className || '', // Handles fallback keys safely
            subject: data.subjectName || '',
            subjectCode: data.subjectCode || '',
            teacherName: data.teacherName,
            load: data.load
          };
        });

        setTeacherSchedule(scheduleMap);
      } catch {
        setError("Failed to load schedule.");
      } finally {
        setLoadingSchedule(false);
      }
    };

    load(selectedTeacher.value);
  }, [selectedTeacher]);

  const getCellEntry = (dayKey, periodNum) => teacherSchedule[dayKey]?.[periodNum] || null;
  const fmt = (n) => (n % 1 === 0 ? String(n) : n.toFixed(2));

  // Compute values dynamically from utility configurations
  const maxLoad = loadInfo?.maxLoad ?? getDesignationLimit(selectedTeacher?.label || "");
  const remainingLoad = loadInfo?.remainingLoad ?? maxLoad;
  const totalLoad = Number((maxLoad - remainingLoad).toFixed(2));
  const exceedsLimit = totalLoad > maxLoad;

  // Count theory and lab loads safely
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
                <span className="load-value">{getDesignationInfo(selectedTeacher.label).label}</span>
              </div>
              <div className="load-item">
                <strong>Load Limit:</strong> <span className="load-value">{maxLoad}</span>
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
                    {TIME_SLOTS.map((slot, idx) => (
                      <th key={idx} className={slot.isLunch ? "lunch-header" : "period-header"}>
                        {slot.time}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {GENERATOR_DAYS.map((dayKey) => (
                    <tr key={dayKey}>
                      <td className="day-cell">
                        <div className="day-name">{DAY_LABELS[dayKey]}</div>
                      </td>
                      {TIME_SLOTS.map((slot, sIdx) => {
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
                  ))}
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