import React, { useState, useEffect } from 'react';
import Select from 'react-select';
import { db } from '../firebase';
import { collection, getDocs, onSnapshot, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';

import { DAYS, DAYS_TO_FETCH, DAY_TO_KEY, TIME_SLOTS, getDesignationLimit } from './routineUtils';
import { exportRoutineToDocx } from './RoutineDocxExporter';

import './table.layout.css';
import './table.feedback.css';

function RoutineTable({ 
  routineId = 1, 
  routineNumber = 1,
  updateTeacherSchedule = () => {}, 
  isTeacherAvailable = () => true,
  getConflictingRoutine = () => null 
}) {
  const [routines, setRoutines] = useState([]);
  const [selectedRoutine, setSelectedRoutine] = useState(null);
  const [scheduleData, setScheduleData] = useState({});
  
  const [subjectsMap, setSubjectsMap] = useState({});
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [error, setError] = useState('');
  const [activeCell, setActiveCell] = useState(null);
  const [teachersCache, setTeachersCache] = useState({});
  const [feedbackMessage, setFeedbackMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [checkingConflict, setCheckingConflict] = useState(false);

  const [editData, setEditData] = useState({
    subjectCode: '', subjectName: '', teacherId: '', teacherName: '', room: ''
  });

  const routineOptions = routines.map(routine => ({
    value: routine.id, label: routine.name || routine.id, data: routine
  }));

  const selectedOption = selectedRoutine 
    ? routineOptions.find(opt => opt.value === selectedRoutine.id) 
    : null;

  const sendPushifyNotification = async (routineName) => {
    try {
      const response = await fetch('http://localhost:8080/api/notify-students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Routine Updated',
          description: `${routineName} has changed — please check the dashboard.`
        })
      });

      if (!response.ok) {
        console.warn('Backend rejected notification request:', response.status);
        return;
      }
      console.log(`Notification triggered for ${routineName}`);
    } catch (err) {
      console.error('Failed to reach notification backend:', err);
    }
  };

  const checkTeacherConflictInDatabase = async (teacherId, day, period) => {
    if (!teacherId) return null;
    setCheckingConflict(true);
    try {
      const dayKey = DAY_TO_KEY[day];
      const slotId = `${dayKey}_${period}`;
      const slotRef = doc(db, 'Faculty_Routine', teacherId, 'slots', slotId);
      const slotSnap = await getDoc(slotRef);
      if (slotSnap.exists()) {
        return { routineName: slotSnap.data().className };
      }
      return null;
    } catch (err) {
      console.error('Conflict check failed:', err);
      return null;
    } finally {
      setCheckingConflict(false);
    }
  };

  const checkTeacherOverload = async (teacherId, teacherName, slotLoad) => {
    if (!teacherId) return null;
    try {
      const teacherDocRef = doc(db, 'Faculty_Routine', teacherId);
      const teacherSnap = await getDoc(teacherDocRef);
      const { label, limit } = getDesignationLimit(teacherName);

      if (teacherSnap.exists()) {
        const remainingLoad = teacherSnap.data().remainingLoad ?? limit;
        const overloaded = remainingLoad < slotLoad;
        const overage = Number((slotLoad - remainingLoad).toFixed(2));
        return { remainingLoad, limit, label, overloaded, overage };
      }
      return { remainingLoad: limit, limit, label, overloaded: false, overage: 0 };
    } catch (err) {
      console.error('Error checking overload:', err);
      return null;
    }
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'routines'),
      (snapshot) => {
        setRoutines(snapshot.empty ? [] : snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      (err) => { console.error(err); setError('Failed to load routines.'); }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedRoutine) { setScheduleData({}); return; }
    setLoadingSchedule(true);
    const unsubscribers = [];
    DAYS_TO_FETCH.forEach(day => {
      const unsubscribe = onSnapshot(collection(db, 'routines', selectedRoutine.id, day), (snapshot) => {
        const periods = snapshot.docs
          .map(d => ({ id: d.id, periodNumber: parseInt(d.id), ...d.data() }))
          .sort((a, b) => a.periodNumber - b.periodNumber);
        setScheduleData(prev => ({ ...prev, [day]: periods }));
        setLoadingSchedule(false);
      }, () => setLoadingSchedule(false));
      unsubscribers.push(unsubscribe);
    });
    return () => unsubscribers.forEach(u => u());
  }, [selectedRoutine]);

  useEffect(() => {
    const loadSubjects = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'subjects'));
        const subjects = {};
        snapshot.forEach(d => { subjects[d.id] = { name: d.data().name || 'Unknown' }; });
        setSubjectsMap(subjects);
      } catch (err) {
        setError('Failed to load subjects.');
      } finally {
        setLoadingSubjects(false);
      }
    };
    loadSubjects();
  }, []);

  const loadTeachersForSubject = async (subjectCode) => {
    if (teachersCache[subjectCode]) return;
    try {
      const snapshot = await getDocs(collection(db, 'subjects', subjectCode, 'teachers'));
      const teachers = {};
      snapshot.forEach(d => { teachers[d.id] = d.data().name; });
      setTeachersCache(prev => ({ ...prev, [subjectCode]: teachers }));
    } catch (err) {
      console.error(`Error loading teachers for ${subjectCode}:`, err);
    }
  };

  const getPeriodData = (day, periodNumber) => {
    const dayKey = day.toLowerCase().substring(0, 3);
    const period = (scheduleData[dayKey] || []).find(p => p.periodNumber === periodNumber);
    if (!period) return null;
    return {
      subject: period.sname || period.subject || period.name || '',
      teacher: period.tname || period.teacher || period.faculty || '',
      code: period.scode || period.code || '',
      room: period.room || period.venue || '',
      teacherId: period.teacherId || '',
      subjectCode: period.scode || period.code || ''
    };
  };

  const handleRoutineSelect = (option) => {
    if (option) {
      setSelectedRoutine(option.data);
      setActiveCell(null);
      setFeedbackMessage(null);
    } else {
      setSelectedRoutine(null);
      setScheduleData({});
    }
  };

  const handleCellClick = (day, period) => {
    if (!selectedRoutine) return;
    const periodData = getPeriodData(day, period);
    setActiveCell({ day, period });
    setEditData({
      subjectCode: periodData?.subjectCode || '',
      subjectName: periodData?.subject || '',
      teacherId: periodData?.teacherId || '',
      teacherName: periodData?.teacher || '',
      room: periodData?.room || ''
    });
    setFeedbackMessage(null);
    if (periodData?.subjectCode) loadTeachersForSubject(periodData.subjectCode);
  };

  const handleSubjectSelect = async (subjectCode) => {
    setEditData(prev => ({
      ...prev,
      subjectCode,
      subjectName: subjectCode ? subjectsMap[subjectCode]?.name || '' : '',
      teacherId: '',
      teacherName: ''
    }));
    if (subjectCode) await loadTeachersForSubject(subjectCode);
  };

  const handleTeacherSelect = async (teacherId) => {
    const teacherName = teacherId && editData.subjectCode
      ? teachersCache[editData.subjectCode]?.[teacherId] || ''
      : '';

    if (teacherId && activeCell && selectedRoutine) {
      const conflict = await checkTeacherConflictInDatabase(
        teacherId, activeCell.day, activeCell.period
      );
      if (conflict) {
        setFeedbackMessage({
          type: 'error',
          message: `⚠ Conflict! This teacher is already assigned to "${conflict.routineName}" at this day & period.`
        });
        return;
      }
    }

    setEditData(prev => ({ ...prev, teacherId, teacherName }));
    setFeedbackMessage(null);
  };

  const handleRoomChange = (room) => {
    setEditData(prev => ({ ...prev, room }));
  };

  const saveCell = async () => {
    if (!selectedRoutine || !activeCell) return;
    const { day, period } = activeCell;
    const dayKey = DAY_TO_KEY[day];
    if (!dayKey) { setFeedbackMessage({ type: 'error', message: 'Invalid day.' }); return; }

    const slotId = `${dayKey}_${period}`;
    const prevData = getPeriodData(day, period);

    if (editData.teacherId) {
      const conflict = await checkTeacherConflictInDatabase(editData.teacherId, day, period);
      if (conflict) {
        setFeedbackMessage({
          type: 'error',
          message: `⚠ Conflict! This teacher is already assigned to "${conflict.routineName}" at this day & period. Cannot save.`
        });
        return;
      }
    }

    const isLab = /\blab\b|\blaboratory\b/i.test(editData.subjectName || '');
    const slotLoad = isLab ? 1.0 : 1.5;

    if (editData.teacherId && editData.subjectName) {
      const overload = await checkTeacherOverload(editData.teacherId, editData.teacherName, slotLoad);
      if (overload && overload.overloaded) {
        setFeedbackMessage({
          type: 'error',
          message: `⚠ Weekly load full! ${editData.teacherName} (${overload.label}) — Remaining: ${overload.remainingLoad} / ${overload.limit}. Needs ${slotLoad}, short by ${overload.overage}.`
        });
        return;
      }
    }

    setSaving(true);
    setFeedbackMessage(null);

    try {
      const periodDocRef = doc(db, 'routines', selectedRoutine.id, dayKey, String(period));

      if (!editData.subjectCode) {
        await deleteDoc(periodDocRef);

        if (prevData?.teacherId) {
          const prevSlotRef = doc(db, 'Faculty_Routine', prevData.teacherId, 'slots', slotId);
          const prevSlotSnap = await getDoc(prevSlotRef);
          await deleteDoc(prevSlotRef);

          if (prevSlotSnap.exists()) {
            const restoredLoad = prevSlotSnap.data().load || 0;
            const oldTeacherRef = doc(db, 'Faculty_Routine', prevData.teacherId);
            const oldTeacherSnap = await getDoc(oldTeacherRef);
            if (oldTeacherSnap.exists()) {
              const oldRemaining = oldTeacherSnap.data().remainingLoad ?? 0;
              await setDoc(oldTeacherRef, {
                remainingLoad: Number((oldRemaining + restoredLoad).toFixed(2))
              }, { merge: true });
            }
          }
        }

        setFeedbackMessage({ type: 'success', message: 'Cell cleared successfully!' });
      } else {
        await setDoc(periodDocRef, {
          scode: editData.subjectCode,
          sname: editData.subjectName,
          teacherId: editData.teacherId,
          tname: editData.teacherName,
          room: editData.room,
          updatedAt: new Date().toISOString()
        }, { merge: true });

        if (prevData?.teacherId && prevData.teacherId !== editData.teacherId) {
          const prevSlotRef = doc(db, 'Faculty_Routine', prevData.teacherId, 'slots', slotId);
          const prevSlotSnap = await getDoc(prevSlotRef);
          await deleteDoc(prevSlotRef);

          if (prevSlotSnap.exists()) {
            const restoredLoad = prevSlotSnap.data().load || 0;
            const oldTeacherRef = doc(db, 'Faculty_Routine', prevData.teacherId);
            const oldTeacherSnap = await getDoc(oldTeacherRef);
            if (oldTeacherSnap.exists()) {
              const oldRemaining = oldTeacherSnap.data().remainingLoad ?? 0;
              await setDoc(oldTeacherRef, {
                remainingLoad: Number((oldRemaining + restoredLoad).toFixed(2))
              }, { merge: true });
            }
          }
        }

        if (editData.teacherId) {
          const facultySlotRef = doc(db, 'Faculty_Routine', editData.teacherId, 'slots', slotId);
          await setDoc(facultySlotRef, {
            className: selectedRoutine.name || selectedRoutine.id,
            day: dayKey,
            period: period,
            teacherName: editData.teacherName,
            load: slotLoad,
            subjectName: editData.subjectName,
            subjectCode: editData.subjectCode
          });

          const { limit } = getDesignationLimit(editData.teacherName);
          const teacherDocRef = doc(db, 'Faculty_Routine', editData.teacherId);
          const teacherSnap = await getDoc(teacherDocRef);

          if (teacherSnap.exists()) {
            const oldRemaining = teacherSnap.data().remainingLoad ?? limit;
            await setDoc(teacherDocRef, {
              remainingLoad: Number((oldRemaining - slotLoad).toFixed(2))
            }, { merge: true });
          } else {
            await setDoc(teacherDocRef, {
              teacherName: editData.teacherName,
              maxLoad: limit,
              remainingLoad: Number((limit - slotLoad).toFixed(2))
            });
          }
        }

        setFeedbackMessage({ type: 'success', message: 'Saved successfully!' });
      }

      const timeSlot = TIME_SLOTS.find(s => s.period === period)?.time;
      const dayIndex = DAYS.indexOf(day);
      if (prevData?.teacherId !== editData.teacherId) {
        updateTeacherSchedule(selectedRoutine.id, dayIndex, timeSlot, editData.teacherId, prevData?.teacherId);
      }

      sendPushifyNotification(selectedRoutine.name || selectedRoutine.id);

      setTimeout(() => { setActiveCell(null); setFeedbackMessage(null); }, 1500);
    } catch (err) {
      setFeedbackMessage({ type: 'error', message: `Failed to save: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const clearCell = async () => {
    if (!selectedRoutine || !activeCell) return;
    const { day, period } = activeCell;
    const dayKey = DAY_TO_KEY[day];
    const slotId = `${dayKey}_${period}`;
    setSaving(true);
    try {
      const prevData = getPeriodData(day, period);

      await deleteDoc(doc(db, 'routines', selectedRoutine.id, dayKey, String(period)));

      if (prevData?.teacherId) {
        const prevSlotRef = doc(db, 'Faculty_Routine', prevData.teacherId, 'slots', slotId);
        const prevSlotSnap = await getDoc(prevSlotRef);
        await deleteDoc(prevSlotRef);

        if (prevSlotSnap.exists()) {
          const restoredLoad = prevSlotSnap.data().load || 0;
          const teacherDocRef = doc(db, 'Faculty_Routine', prevData.teacherId);
          const teacherSnap = await getDoc(teacherDocRef);
          if (teacherSnap.exists()) {
            const oldRemaining = teacherSnap.data().remainingLoad ?? 0;
            await setDoc(teacherDocRef, {
              remainingLoad: Number((oldRemaining + restoredLoad).toFixed(2))
            }, { merge: true });
          }
        }
      }

      const timeSlot = TIME_SLOTS.find(s => s.period === period)?.time;
      const dayIndex = DAYS.indexOf(day);
      if (prevData?.teacherId) {
        updateTeacherSchedule(selectedRoutine.id, dayIndex, timeSlot, null, prevData.teacherId);
      }

      setFeedbackMessage({ type: 'success', message: 'Cell cleared!' });
      sendPushifyNotification(selectedRoutine.name || selectedRoutine.id);

      setTimeout(() => { setActiveCell(null); setFeedbackMessage(null); }, 1500);
    } catch (err) {
      setFeedbackMessage({ type: 'error', message: `Failed to clear: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setActiveCell(null);
    setEditData({ subjectCode: '', subjectName: '', teacherId: '', teacherName: '', room: '' });
    setFeedbackMessage(null);
  };

  const handleDownload = () => {
    exportRoutineToDocx(selectedRoutine, getPeriodData);
  };

  if (loadingSubjects) return <div className="table-container"><p className="loading">Loading subjects...</p></div>;
  if (error) return (
    <div className="table-container">
      <div className="error-box">
        <p className="error-message">{error}</p>
        <button className="btn-retry" onClick={() => window.location.reload()}>Refresh</button>
      </div>
    </div>
  );

  return (
    <div className="table-container">
      <div className="routine-selector">
        <label>Select Routine:</label>
        <Select
          value={selectedOption}
          onChange={handleRoutineSelect}
          options={routineOptions}
          className="routine-select"
          classNamePrefix="routine-select"
          placeholder="Choose a routine..."
          isSearchable
          isClearable
          isDisabled={loadingSchedule}
          noOptionsMessage={() => 'No routines found. Create one in the admin panel.'}
        />
      </div>

      {loadingSchedule && <div className="loading-box">Loading schedule...</div>}

      {selectedRoutine && !loadingSchedule && (
        <>
          <h2 className="table-title">{selectedRoutine.name || selectedRoutine.id}</h2>

          {(checkingConflict || feedbackMessage) && (
            <div className="table-notification">
              {checkingConflict && !feedbackMessage && (
                <div className="loading-box">
                  <span className="loading-spinner"></span>
                  Checking teacher availability…
                </div>
              )}
              {feedbackMessage && (
                <div className={feedbackMessage.type === 'error' ? 'feedback-error' : 'feedback-success'}>
                  {feedbackMessage.message}
                </div>
              )}
            </div>
          )}

          <div className="table-wrapper">
            <table className="routine-table">
              <thead>
                <tr>
                  <th className="day-column">Day / Time</th>
                  {TIME_SLOTS.map((slot, idx) => (
                    <th key={idx} className={slot.isLunch ? 'lunch-header' : 'period-header'}>
                      {slot.time}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((day, dayIndex) => (
                  <tr key={dayIndex}>
                    <td className="day-cell"><div className="day-name">{day}</div></td>
                    {TIME_SLOTS.map((slot, idx) => {
                      if (slot.isLunch) {
                        return (
                          <td key={idx} className="lunch-cell">
                            <div className="lunch-content"><span className="lunch-text">Lunch Break</span></div>
                          </td>
                        );
                      }
                      const periodData = getPeriodData(day, slot.period);
                      const isActive = activeCell?.day === day && activeCell?.period === slot.period;
                      return (
                        <td key={idx} className={`subject-cell ${isActive ? 'cell-active' : ''}`}>
                          {isActive ? (
                            <div className="cell-editor">
                              <select
                                value={editData.subjectCode}
                                onChange={(e) => handleSubjectSelect(e.target.value)}
                                className="edit-select"
                                disabled={saving || checkingConflict}
                              >
                                <option value="">-- Select Subject --</option>
                                {Object.entries(subjectsMap).map(([code, data]) => (
                                  <option key={code} value={code}>[{code}] {data.name}</option>
                                ))}
                              </select>

                              {editData.subjectCode && teachersCache[editData.subjectCode] && (
                                <select
                                  value={editData.teacherId}
                                  onChange={(e) => handleTeacherSelect(e.target.value)}
                                  className="edit-select"
                                  disabled={saving || checkingConflict}
                                >
                                  <option value="">-- Select Teacher --</option>
                                  {Object.entries(teachersCache[editData.subjectCode] || {}).map(([id, name]) => (
                                    <option key={id} value={id}>{name}</option>
                                  ))}
                                </select>
                              )}

                              {editData.subjectCode && (
                                <input
                                  type="text"
                                  value={editData.room}
                                  onChange={(e) => handleRoomChange(e.target.value)}
                                  placeholder="Room"
                                  className="edit-input"
                                  disabled={saving || checkingConflict}
                                />
                              )}

                              <div className="edit-actions">
                                <button onClick={saveCell} className="btn-save" disabled={saving || checkingConflict}>
                                  {saving ? 'Saving...' : 'Save'}
                                </button>
                                <button onClick={clearCell} className="btn-clear" disabled={saving || checkingConflict}>Clear</button>
                                <button onClick={cancelEdit} className="btn-cancel" disabled={saving || checkingConflict}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="cell-content cell-clickable" onClick={() => handleCellClick(day, slot.period)}>
                              {periodData?.subject ? (
                                <>
                                  <div className="subject-name">{periodData.subject}</div>
                                  {periodData.code && <div className="subject-code">[{periodData.code}]</div>}
                                  {periodData.teacher && <div className="teacher-name">{periodData.teacher}</div>}
                                  {periodData.room && <div className="room-name">Room: {periodData.room}</div>}
                                </>
                              ) : (
                                <div className="cell-empty"><span className="add-text">+ Add</span></div>
                              )}
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

          <div className="table-footer">
            <button onClick={handleDownload} className="btn-download">Download as DOCX</button>
          </div>

          <div className="info-footer">
            <p>Changes are saved to the database automatically.</p>
          </div>
        </>
      )}

      {!selectedRoutine && routines.length > 0 && !loadingSchedule && (
        <div className="no-selection">
          <h3>Select a Routine</h3>
          <p>Choose a routine from the dropdown to view and edit the schedule</p>
        </div>
      )}

      {routines.length === 0 && !loadingSubjects && (
        <div className="no-selection">
          <h3>No Routines Found</h3>
          <p>Please create a routine from your admin panel or another management page.</p>
        </div>
      )}
    </div>
  );
}

export default RoutineTable;