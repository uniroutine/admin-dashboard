// src/components/table.jsx
import React, { useState, useEffect } from 'react';
import Select from 'react-select';
import { db } from '../firebase';
import { collection, getDocs, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import './table.css';

// Import libraries for DOCX generation and file saving
import { Packer, Document, Table, TableRow, TableCell, Paragraph, WidthType, BorderStyle, AlignmentType, VerticalAlign } from 'docx';
import { saveAs } from 'file-saver';

function RoutineTable({ 
  routineId = 1, 
  routineNumber = 1,
  updateTeacherSchedule = () => {}, 
  isTeacherAvailable = () => true,
  getConflictingRoutine = () => null 
}) {
  // Routine selection states
  const [routines, setRoutines] = useState([]);
  const [selectedRoutine, setSelectedRoutine] = useState(null);
  const [scheduleData, setScheduleData] = useState({});
  
  const daysToFetch = ['mon', 'tue', 'wed', 'thu', 'fri'];
  
  const dayDisplayNames = {
    'mon': 'Monday',
    'tue': 'Tuesday',
    'wed': 'Wednesday',
    'thu': 'Thursday',
    'fri': 'Friday'
  };

  const dayToKey = {
    'Monday': 'mon',
    'Tuesday': 'tue',
    'Wednesday': 'wed',
    'Thursday': 'thu',
    'Friday': 'fri'
  };

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  
  const timeSlots = [
    { period: 1, time: '9:00 - 10:00' },
    { period: 2, time: '10:00 - 11:00' },
    { period: 3, time: '11:00 - 12:00' },
    { period: 4, time: '12:00 - 1:00', isLunch: true },
    { period: 5, time: '1:00 - 2:00' },
    { period: 6, time: '2:00 - 3:00' },
    { period: 7, time: '3:00 - 4:00' },
    { period: 8, time: '4:00 - 5:00' }
  ];

  const [subjectsMap, setSubjectsMap] = useState({});
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [error, setError] = useState('');
  const [activeCell, setActiveCell] = useState(null);
  const [teachersCache, setTeachersCache] = useState({});
  const [feedbackMessage, setFeedbackMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const [editData, setEditData] = useState({
    subjectCode: '',
    subjectName: '',
    teacherId: '',
    teacherName: '',
    room: ''
  });

  const routineOptions = routines.map(routine => ({
    value: routine.id,
    label: routine.name || routine.id,
    data: routine
  }));

  const selectedOption = selectedRoutine 
    ? routineOptions.find(opt => opt.value === selectedRoutine.id) 
    : null;

  // Fetch all routines from Firestore
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'routines'),
      (snapshot) => {
        if (!snapshot.empty) {
          const routinesList = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setRoutines(routinesList);
        } else {
          setRoutines([]);
        }
      },
      (err) => {
        console.error('Error fetching routines:', err);
        setError('Failed to load routines.');
      }
    );

    return () => unsubscribe();
  }, []);

  // Fetch schedule data when a routine is selected
  useEffect(() => {
    if (!selectedRoutine) {
      setScheduleData({});
      return;
    }

    setLoadingSchedule(true);
    const unsubscribers = [];

    daysToFetch.forEach(day => {
      const dayRef = collection(db, 'routines', selectedRoutine.id, day);
      
      const unsubscribe = onSnapshot(dayRef, (snapshot) => {
        if (!snapshot.empty) {
          const periods = [];
          snapshot.forEach(doc => {
            periods.push({
              id: doc.id,
              periodNumber: parseInt(doc.id),
              ...doc.data()
            });
          });
          
          periods.sort((a, b) => a.periodNumber - b.periodNumber);
          
          setScheduleData(prev => ({
            ...prev,
            [day]: periods
          }));
        } else {
          setScheduleData(prev => ({
            ...prev,
            [day]: []
          }));
        }
        setLoadingSchedule(false);
      }, (err) => {
        console.error(`Error fetching ${day} schedule:`, err);
        setLoadingSchedule(false);
      });

      unsubscribers.push(unsubscribe);
    });

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [selectedRoutine]);

  // Load subjects
  useEffect(() => {
    const loadSubjects = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'subjects'));
        const subjects = {};

        querySnapshot.forEach(doc => {
          subjects[doc.id] = {
            name: doc.data().name || 'Unknown',
          };
        });

        setSubjectsMap(subjects);
      } catch (err) {
        setError('Failed to load subjects.');
        console.error('Subject loading error:', err);
      } finally {
        setLoadingSubjects(false);
      }
    };

    loadSubjects();
  }, []);

  const loadTeachersForSubject = async (subjectCode) => {
    if (teachersCache[subjectCode]) return;
    
    try {
      const teachersRef = collection(db, 'subjects', subjectCode, 'teachers');
      const snapshot = await getDocs(teachersRef);
      const teachers = {};
      snapshot.forEach(doc => {
        teachers[doc.id] = doc.data().name;
      });
      setTeachersCache(prev => ({ ...prev, [subjectCode]: teachers }));
    } catch (err) {
      console.error(`Error loading teachers for ${subjectCode}:`, err);
    }
  };

  const getPeriodData = (day, periodNumber) => {
    const dayKey = day.toLowerCase().substring(0, 3);
    const daySchedule = scheduleData[dayKey];
    
    if (!daySchedule) return null;
    
    const period = daySchedule.find(p => p.periodNumber === periodNumber);
    
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
      subjectCode: periodData?.subjectCode || periodData?.code || '',
      subjectName: periodData?.subject || periodData?.name || '',
      teacherId: periodData?.teacherId || '',
      teacherName: periodData?.teacher || '',
      room: periodData?.room || ''
    });
    setFeedbackMessage(null);

    if (periodData?.subjectCode || periodData?.code) {
      loadTeachersForSubject(periodData?.subjectCode || periodData?.code);
    }
  };

  const handleSubjectSelect = async (subjectCode) => {
    const subjectName = subjectCode ? subjectsMap[subjectCode]?.name || '' : '';
    
    setEditData(prev => ({
      ...prev,
      subjectCode,
      subjectName,
      teacherId: '',
      teacherName: ''
    }));

    if (subjectCode) {
      await loadTeachersForSubject(subjectCode);
    }
  };

  const handleTeacherSelect = (teacherId) => {
    const teacherName = teacherId && editData.subjectCode 
      ? teachersCache[editData.subjectCode]?.[teacherId] || '' 
      : '';

    if (teacherId && activeCell) {
      const timeSlot = timeSlots.find(s => s.period === activeCell.period)?.time;
      const dayIndex = days.indexOf(activeCell.day);
      
      if (!isTeacherAvailable(selectedRoutine?.id, dayIndex, timeSlot, teacherId)) {
        const conflictingRoutineNumber = getConflictingRoutine(selectedRoutine?.id, dayIndex, timeSlot, teacherId);
        
        setFeedbackMessage({
          type: 'error',
          message: `Cannot assign ${teacherName}. Already scheduled in Routine ${conflictingRoutineNumber}.`
        });
        return;
      }
    }

    setEditData(prev => ({
      ...prev,
      teacherId,
      teacherName
    }));
    setFeedbackMessage(null);
  };

  const handleRoomChange = (room) => {
    setEditData(prev => ({
      ...prev,
      room
    }));
  };

  const saveCell = async () => {
    if (!selectedRoutine || !activeCell) return;

    const { day, period } = activeCell;
    const dayKey = dayToKey[day];
    
    if (!dayKey) {
      setFeedbackMessage({ type: 'error', message: 'Invalid day selected.' });
      return;
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
        updateTeacherSchedule(
          selectedRoutine.id, 
          dayIndex, 
          timeSlot, 
          editData.teacherId, 
          prevData?.teacherId
        );
      }

      setTimeout(() => {
        setActiveCell(null);
        setFeedbackMessage(null);
      }, 1000);

    } catch (err) {
      console.error('Error saving cell:', err);
      setFeedbackMessage({ 
        type: 'error', 
        message: `Failed to save: ${err.message}` 
      });
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
      const periodDocRef = doc(db, 'routines', selectedRoutine.id, dayKey, String(period));
      await deleteDoc(periodDocRef);

      const timeSlot = timeSlots.find(s => s.period === period)?.time;
      const dayIndex = days.indexOf(day);
      const prevData = getPeriodData(day, period);
      
      if (prevData?.teacherId) {
        updateTeacherSchedule(selectedRoutine.id, dayIndex, timeSlot, null, prevData.teacherId);
      }

      setFeedbackMessage({ type: 'success', message: 'Cell cleared!' });
      
      setTimeout(() => {
        setActiveCell(null);
        setFeedbackMessage(null);
      }, 1000);

    } catch (err) {
      console.error('Error clearing cell:', err);
      setFeedbackMessage({ type: 'error', message: `Failed to clear: ${err.message}` });
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setActiveCell(null);
    setEditData({
      subjectCode: '',
      subjectName: '',
      teacherId: '',
      teacherName: '',
      room: ''
    });
    setFeedbackMessage(null);
  };

  const handleDownload = () => {
    if (!selectedRoutine) {
      alert('Please select a routine first.');
      return;
    }

    const docFile = new Document({
      sections: [
        {
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
                          return new TableCell({
                            children: [new Paragraph('Lunch Break')],
                            verticalAlign: VerticalAlign.CENTER,
                          });
                        }
                        const periodData = getPeriodData(day, slot.period);
                        let cellText = '-';
                        if (periodData && periodData.subject) {
                          cellText = `${periodData.subject}`;
                          if (periodData.code) cellText += `\n[${periodData.code}]`;
                          if (periodData.teacher) cellText += `\n${periodData.teacher}`;
                          if (periodData.room) cellText += `\nRoom: ${periodData.room}`;
                        }
                        return new TableCell({
                          children: [new Paragraph(cellText)],
                          verticalAlign: VerticalAlign.CENTER,
                        });
                      }),
                    ],
                  })
                ),
              ],
            }),
          ],
        },
      ],
    });

    Packer.toBlob(docFile)
      .then(blob => {
        const fileName = selectedRoutine.name || selectedRoutine.id || 'schedule';
        saveAs(blob, `${fileName}_routine.docx`);
      })
      .catch(err => {
        console.error('Error generating DOCX:', err);
        alert('Failed to generate DOCX. Please try again.');
      });
  };

  if (loadingSubjects) {
    return (
      <div className="table-container">
        <p className="loading">Loading subjects...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="table-container">
        <div className="error-box">
          <p className="error-message">{error}</p>
          <button className="btn-retry" onClick={() => window.location.reload()}>
            Refresh
          </button>
        </div>
      </div>
    );
  }

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
          isSearchable={true}
          isClearable={true}
          isDisabled={loadingSchedule}
          noOptionsMessage={() => "No routines found. Create one in the admin panel."}
        />
      </div>

      {feedbackMessage && (
        <div className={`feedback-message ${feedbackMessage.type === 'error' ? 'feedback-error' : 'feedback-success'}`}>
          {feedbackMessage.message}
        </div>
      )}

      {loadingSchedule && (
        <div className="loading-box">Loading schedule...</div>
      )}

      {selectedRoutine && !loadingSchedule && (
        <>
          <h2 className="table-title">
            {selectedRoutine.name || selectedRoutine.id}
          </h2>

          <div className="table-wrapper">
            <table className="routine-table">
              <thead>
                <tr>
                  <th className="day-column">Day / Time</th>
                  {timeSlots.map((slot, idx) => (
                    <th 
                      key={idx} 
                      className={slot.isLunch ? 'lunch-header' : 'period-header'}
                    >
                      {slot.time}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((day, dayIndex) => (
                  <tr key={dayIndex}>
                    <td className="day-cell">
                      <div className="day-name">{day}</div>
                    </td>
                    {timeSlots.map((slot, idx) => {
                      if (slot.isLunch) {
                        return (
                          <td key={idx} className="lunch-cell">
                            <div className="lunch-content">
                              <span className="lunch-text">Lunch Break</span>
                            </div>
                          </td>
                        );
                      }

                      const periodData = getPeriodData(day, slot.period);
                      const isActive = activeCell?.day === day && activeCell?.period === slot.period;

                      return (
                        <td 
                          key={idx} 
                          className={`subject-cell ${isActive ? 'cell-active' : ''}`}
                        >
                          {isActive ? (
                            <div className="cell-editor">
                              <select
                                value={editData.subjectCode}
                                onChange={(e) => handleSubjectSelect(e.target.value)}
                                className="edit-select"
                                disabled={saving}
                              >
                                <option value="">-- Select Subject --</option>
                                {Object.entries(subjectsMap).map(([code, data]) => (
                                  <option key={code} value={code}>
                                    [{code}] {data.name}
                                  </option>
                                ))}
                              </select>

                              {editData.subjectCode && teachersCache[editData.subjectCode] && (
                                <select
                                  value={editData.teacherId}
                                  onChange={(e) => handleTeacherSelect(e.target.value)}
                                  className="edit-select"
                                  disabled={saving}
                                >
                                  <option value="">-- Select Teacher --</option>
                                  {Object.entries(teachersCache[editData.subjectCode] || {}).map(([id, name]) => {
                                    const timeSlot = timeSlots.find(s => s.period === slot.period)?.time;
                                    const isUnavailable = !isTeacherAvailable(selectedRoutine?.id, dayIndex, timeSlot, id);
                                    const conflictRoutine = isUnavailable ? getConflictingRoutine(selectedRoutine?.id, dayIndex, timeSlot, id) : null;
                                    
                                    return (
                                      <option 
                                        key={id} 
                                        value={id}
                                        className={isUnavailable ? 'teacher-unavailable' : ''}
                                      >
                                        {name} {isUnavailable ? `(Routine ${conflictRoutine})` : ''}
                                      </option>
                                    );
                                  })}
                                </select>
                              )}

                              {editData.subjectCode && (
                                <input
                                  type="text"
                                  value={editData.room}
                                  onChange={(e) => handleRoomChange(e.target.value)}
                                  placeholder="Room"
                                  className="edit-input"
                                  disabled={saving}
                                />
                              )}

                              <div className="edit-actions">
                                <button 
                                  onClick={saveCell} 
                                  className="btn-save"
                                  disabled={saving}
                                >
                                  {saving ? 'Saving...' : 'Save'}
                                </button>
                                <button 
                                  onClick={clearCell} 
                                  className="btn-clear"
                                  disabled={saving}
                                >
                                  Clear
                                </button>
                                <button 
                                  onClick={cancelEdit} 
                                  className="btn-cancel"
                                  disabled={saving}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div 
                              className="cell-content cell-clickable"
                              onClick={() => handleCellClick(day, slot.period)}
                            >
                              {periodData && periodData.subject ? (
                                <>
                                  <div className="subject-name">{periodData.subject}</div>
                                  {periodData.code && (
                                    <div className="subject-code">[{periodData.code}]</div>
                                  )}
                                  {periodData.teacher && (
                                    <div className="teacher-name">{periodData.teacher}</div>
                                  )}
                                  {periodData.room && (
                                    <div className="room-name">Room: {periodData.room}</div>
                                  )}
                                </>
                              ) : (
                                <div className="cell-empty">
                                  <span className="add-text">+ Add</span>
                                </div>
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

          <button onClick={handleDownload} className="btn-download">
            Download as DOCX
          </button>

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
