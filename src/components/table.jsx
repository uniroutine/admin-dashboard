// src/components/table.jsx
import React, { useState, useEffect } from 'react';
import Select from 'react-select';
import { db } from '../firebase';
import { collection, getDocs, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import './table.layout.css';
import './table.feedback.css';

import { Packer, Document, Table, TableRow, TableCell, Paragraph, WidthType, BorderStyle, AlignmentType, VerticalAlign } from 'docx';
import { saveAs } from 'file-saver';

// --- Designation load limits ---
// Prof = 8, Assoc. Prof = 12, Asst. Prof = 24, default = 12
function getDesignationLimit(teacherName = '') {
  const n = teacherName.toLowerCase();
  if (n.includes('asst.') || n.includes('assistant')) return { label: 'Assistant Professor', limit: 24 };
  if (n.includes('assoc.') || n.includes('associate')) return { label: 'Associate Professor', limit: 12 };
  if (n.includes('prof.') || n.includes('professor')) return { label: 'Professor', limit: 8 };
  return { label: 'Associate Professor (default)', limit: 12 };
}

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
  
  const daysToFetch = ['mon', 'tue', 'wed', 'thu', 'fri'];
  
  const dayToKey = {
    'Monday': 'mon', 'Tuesday': 'tue', 'Wednesday': 'wed',
    'Thursday': 'thu', 'Friday': 'fri'
  };

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  
  const timeSlots = [
    { period: 1, time: '9:00 - 9:50' },
    { period: 2, time: '9:50 - 10:40' },
    { period: 3, time: '10:40 - 11:30' },
    { period: 4, time: '11:30 - 12:20' },
    { period: 5, time: '12:20 - 1:00', isLunch: true },
    { period: 6, time: '1:00 - 1:50' },
    { period: 7, time: '1:50 - 2:40' },
    { period: 8, time: '2:40 - 3:30' },
    { period: 9, time: '3:30 - 4:20' }
  ];

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

  // --- Check teacher conflict across all other routines ---
  // Returns: { routineName, conflictSubject } or null
  const checkTeacherConflictInDatabase = async (teacherId, day, period, currentRoutineId) => {
    if (!teacherId) return null;
    setCheckingConflict(true);
    try {
      const dayKey = dayToKey[day];
      if (!dayKey) return null;
      const routinesSnapshot = await getDocs(collection(db, 'routines'));
      for (const routineDoc of routinesSnapshot.docs) {
        const rId = routineDoc.id;
        if (rId === currentRoutineId) continue;
        const routineName = routineDoc.data().name || rId;
        const daySnapshot = await getDocs(collection(db, 'routines', rId, dayKey));
        const periodDoc = daySnapshot.docs.find(d => d.id === String(period));
        if (periodDoc) {
          const pd = periodDoc.data();
          if (pd.teacherId === teacherId) {
            return {
              routineName,
              conflictSubject: pd.sname || pd.subject || ''
            };
          }
        }
      }
      return null;
    } catch (err) {
      console.error('Error checking conflict:', err);
      return null;
    } finally {
      setCheckingConflict(false);
    }
  };

  // --- Check teacher weekly overload across ALL routines ---
  // Theory = 1.5, Lab = 1. Returns { totalLoad, limit, label, overloaded, overage }
  const checkTeacherOverload = async (teacherId, teacherName, currentRoutineId, currentDay, currentPeriod, newSubjectName) => {
    if (!teacherId) return null;
    try {
      const daysToScan = ['mon', 'tue', 'wed', 'thu', 'fri'];
      let theoryCount = 0;
      let labCount = 0;

      const routinesSnapshot = await getDocs(collection(db, 'routines'));
      for (const routineDoc of routinesSnapshot.docs) {
        const rId = routineDoc.id;
        for (const dayKey of daysToScan) {
          const daySnapshot = await getDocs(collection(db, 'routines', rId, dayKey));
          daySnapshot.forEach((periodDoc) => {
            const data = periodDoc.data();
            if (!data || data.teacherId !== teacherId) return;
            // Skip the cell being replaced so we don't double count
            const isSameCell = rId === currentRoutineId
              && dayKey === dayToKey[currentDay]
              && periodDoc.id === String(currentPeriod);
            if (isSameCell) return;
            const isLab = /\blab\b|\blaboratory\b/i.test(data.sname || data.subject || '');
            if (isLab) labCount += 1;
            else theoryCount += 1;
          });
        }
      }

      // Add the new class being assigned now
      const newIsLab = /\blab\b|\blaboratory\b/i.test(newSubjectName || '');
      if (newIsLab) labCount += 1;
      else theoryCount += 1;

      const totalLoad = Number((theoryCount * 1.5 + labCount * 1).toFixed(2));
      const { label, limit } = getDesignationLimit(teacherName);
      const overloaded = totalLoad > limit;
      const overage = Number((totalLoad - limit).toFixed(2));

      return { totalLoad, limit, label, overloaded, overage };
    } catch (err) {
      console.error('Error checking overload:', err);
      return null;
    }
  };

  // Fetch all routines
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

  // Fetch schedule when routine selected
  useEffect(() => {
    if (!selectedRoutine) { setScheduleData({}); return; }
    setLoadingSchedule(true);
    const unsubscribers = [];
    daysToFetch.forEach(day => {
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

  // Load subjects
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
      // Conflict check on teacher select
      const conflict = await checkTeacherConflictInDatabase(
        teacherId, activeCell.day, activeCell.period, selectedRoutine.id
      );
      if (conflict) {
        const subjectInfo = conflict.conflictSubject ? ` (${conflict.conflictSubject})` : '';
        setFeedbackMessage({
          type: 'error',
          message: `⚠ Conflict! ${teacherName} is already assigned in "${conflict.routineName}"${subjectInfo} at this same day & period.`
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
    const dayKey = dayToKey[day];
    if (!dayKey) { setFeedbackMessage({ type: 'error', message: 'Invalid day.' }); return; }

    // 1. Conflict check before saving
    if (editData.teacherId) {
      const conflict = await checkTeacherConflictInDatabase(
        editData.teacherId, day, period, selectedRoutine.id
      );
      if (conflict) {
        const subjectInfo = conflict.conflictSubject ? ` (${conflict.conflictSubject})` : '';
        setFeedbackMessage({
          type: 'error',
          message: `⚠ Conflict! ${editData.teacherName} is already assigned in "${conflict.routineName}"${subjectInfo} at this same day & period. Cannot save.`
        });
        return;
      }
    }

    // 2. Overload check before saving
    if (editData.teacherId && editData.subjectName) {
      const overload = await checkTeacherOverload(
        editData.teacherId, editData.teacherName,
        selectedRoutine.id, day, period, editData.subjectName
      );
      if (overload && overload.overloaded) {
        setFeedbackMessage({
          type: 'error',
          message: `⚠ Weekly load full! ${editData.teacherName} (${overload.label}) — Current load: ${overload.totalLoad} / ${overload.limit}. Exceeds limit by ${overload.overage}.`
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
        setFeedbackMessage({ type: 'success', message: 'Saved successfully!' });
      }

      const timeSlot = timeSlots.find(s => s.period === period)?.time;
      const dayIndex = days.indexOf(day);
      const prevData = getPeriodData(day, period);
      if (prevData?.teacherId !== editData.teacherId) {
        updateTeacherSchedule(selectedRoutine.id, dayIndex, timeSlot, editData.teacherId, prevData?.teacherId);
      }

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
    const dayKey = dayToKey[day];
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'routines', selectedRoutine.id, dayKey, String(period)));
      const timeSlot = timeSlots.find(s => s.period === period)?.time;
      const dayIndex = days.indexOf(day);
      const prevData = getPeriodData(day, period);
      if (prevData?.teacherId) {
        updateTeacherSchedule(selectedRoutine.id, dayIndex, timeSlot, null, prevData.teacherId);
      }
      setFeedbackMessage({ type: 'success', message: 'Cell cleared!' });
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
    if (!selectedRoutine) { alert('Please select a routine first.'); return; }
    const docFile = new Document({
      sections: [{
        children: [
          new Paragraph({
            text: selectedRoutine.name || selectedRoutine.id || 'Weekly Schedule',
            heading: 'Heading1',
            alignment: AlignmentType.CENTER,
          }),
          new Paragraph({}),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1 },
              bottom: { style: BorderStyle.SINGLE, size: 1 },
              left: { style: BorderStyle.SINGLE, size: 1 },
              right: { style: BorderStyle.SINGLE, size: 1 },
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('Day / Time')] }),
                  ...timeSlots.map(slot => new TableCell({ children: [new Paragraph(slot.time)] })),
                ],
              }),
              ...days.map((day) =>
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph(day)] }),
                    ...timeSlots.map((slot) => {
                      if (slot.isLunch) {
                        return new TableCell({ children: [new Paragraph('Lunch Break')], verticalAlign: VerticalAlign.CENTER });
                      }
                      const pd = getPeriodData(day, slot.period);
                      let cellText = '-';
                      if (pd?.subject) {
                        cellText = pd.subject;
                        if (pd.code) cellText += `\n[${pd.code}]`;
                        if (pd.teacher) cellText += `\n${pd.teacher}`;
                        if (pd.room) cellText += `\nRoom: ${pd.room}`;
                      }
                      return new TableCell({ children: [new Paragraph(cellText)], verticalAlign: VerticalAlign.CENTER });
                    }),
                  ],
                })
              ),
            ],
          }),
        ],
      }],
    });
    Packer.toBlob(docFile)
      .then(blob => saveAs(blob, `${selectedRoutine.name || selectedRoutine.id}_routine.docx`))
      .catch(err => { console.error(err); alert('Failed to generate DOCX.'); });
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
                  {timeSlots.map((slot, idx) => (
                    <th key={idx} className={slot.isLunch ? 'lunch-header' : 'period-header'}>
                      {slot.time}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((day, dayIndex) => (
                  <tr key={dayIndex}>
                    <td className="day-cell"><div className="day-name">{day}</div></td>
                    {timeSlots.map((slot, idx) => {
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