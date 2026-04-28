// src/components/RoutineGenerator.jsx
import React, { useState, useEffect } from 'react';
import Select from 'react-select';
import { db } from '../firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import './RoutineGenerator.css';

const isLabSubject = (name = '') => /\blab\b|\blaboratory\b/i.test(name);
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const DAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday' };
const ALL_PERIODS = [1, 2, 3, 4, 6, 7, 8, 9];
const ALL_LAB_SLOTS = [[1,2,3],[2,3,4],[6,7,8],[7,8,9]];
const TIME_SLOTS = [
  { period: 1, time: '9:00 - 9:50' },
  { period: 2, time: '9:50 - 10:40' },
  { period: 3, time: '10:40 - 11:30' },
  { period: 4, time: '11:30 - 12:20' },
  { period: 5, time: '12:20 - 1:00', isLunch: true },
  { period: 6, time: '1:00 - 1:50' },
  { period: 7, time: '1:50 - 2:40' },
  { period: 8, time: '2:40 - 3:30' },
  { period: 9, time: '3:30 - 4:20' },
];

function getDesignationLimit(teacherName = '') {
  const n = teacherName.toLowerCase();
  if (n.includes('asst.') || n.includes('assistant')) return 24;
  if (n.includes('assoc.') || n.includes('associate')) return 12;
  if (n.includes('prof.') || n.includes('professor')) return 8;
  return 12;
}

function isTeacherFree(facultyData, dayKey, period) {
  return !facultyData?.slots?.[`${dayKey}_${period}`];
}

function teacherHasLoad(facultyData, teacherName, slotLoad, loadUsed, teacherId) {
  const limit = getDesignationLimit(teacherName);
  const remaining = facultyData?.remainingLoad ?? limit;
  const used = loadUsed[teacherId] || 0;
  return (remaining - used) >= slotLoad;
}


// FEATURE 1: Detect if routine is fresh or edited

function isEditedRoutine(existingSlots) {
  for (const day of DAYS) {
    if (existingSlots[day] && Object.keys(existingSlots[day]).length > 0) {
      return true;
    }
  }
  return false;
}


// FEATURE 2: Lightweight feasibility checking


/**
 * Check if a theory subject can feasibly be placed
 * Returns: { feasible: boolean, reasons: string[] }
 */
function checkTheoryFeasibility(subjectRow, grid, facultyMap, loadUsed) {
  const required = subjectRow.theoryPerWeek;
  const reasons = [];
  
  let freeSlots = 0;
  let teacherAvailableSlots = 0;
  
  for (const day of DAYS) {
    for (const period of ALL_PERIODS) {
      if (!grid[day][period]?.occupied) {
        freeSlots++;
        
        const hasAvailableTeacher = subjectRow.teacherOptions.some(t => {
          const faculty = facultyMap[t.value] || { slots: {} };
          return isTeacherFree(faculty, day, period) && 
                 teacherHasLoad(faculty, t.label, 1.5, loadUsed, t.value);
        });
        
        if (hasAvailableTeacher) {
          teacherAvailableSlots++;
        }
      }
    }
  }
  
  if (freeSlots < required) {
    reasons.push(`Only ${freeSlots} free slots available, need ${required}`);
  }
  
  if (teacherAvailableSlots < required) {
    reasons.push(`Only ${teacherAvailableSlots} slots with available teachers, need ${required}`);
  }
  
  const totalCapacity = subjectRow.teacherOptions.reduce((sum, t) => {
    const faculty = facultyMap[t.value] || {};
    const limit = getDesignationLimit(t.label);
    const remaining = faculty.remainingLoad ?? limit;
    const used = loadUsed[t.value] || 0;
    return sum + Math.max(0, remaining - used);
  }, 0);
  
  const requiredLoad = required * 1.5;
  if (totalCapacity < requiredLoad) {
    reasons.push(`Teacher capacity ${totalCapacity.toFixed(1)}hrs < required ${requiredLoad.toFixed(1)}hrs`);
  }
  
  return {
    feasible: reasons.length === 0,
    reasons,
    availableSlots: teacherAvailableSlots,
    requiredSlots: required
  };
}

/**
 * Check if a lab subject can feasibly be placed
 * Returns: { feasible: boolean, reasons: string[] }
 */
function checkLabFeasibility(subjectRow, grid, facultyMap, loadUsed) {
  const reasons = [];
  let validBlocks = 0;
  
  for (const day of DAYS) {
    for (const slots of ALL_LAB_SLOTS) {
      if (!slots.every(p => !grid[day][p]?.occupied)) continue;
      
      const hasAvailableTeacher = subjectRow.teacherOptions.some(t => {
        const faculty = facultyMap[t.value] || { slots: {} };
        const allFree = slots.every(p => isTeacherFree(faculty, day, p));
        const hasLoad = teacherHasLoad(faculty, t.label, 3.0, loadUsed, t.value);
        return allFree && hasLoad;
      });
      
      if (hasAvailableTeacher) {
        validBlocks++;
      }
    }
  }
  
  if (validBlocks === 0) {
    reasons.push('No 3-consecutive free periods available');
    
    let hasEmptyBlocks = false;
    for (const day of DAYS) {
      for (const slots of ALL_LAB_SLOTS) {
        if (slots.every(p => !grid[day][p]?.occupied)) {
          hasEmptyBlocks = true;
          break;
        }
      }
      if (hasEmptyBlocks) break;
    }
    
    if (hasEmptyBlocks) {
      reasons.push('Free blocks exist but no teacher available for full duration');
    }
  }
  
  const totalCapacity = subjectRow.teacherOptions.reduce((sum, t) => {
    const faculty = facultyMap[t.value] || {};
    const limit = getDesignationLimit(t.label);
    const remaining = faculty.remainingLoad ?? limit;
    const used = loadUsed[t.value] || 0;
    return sum + Math.max(0, remaining - used);
  }, 0);
  
  if (totalCapacity < 3.0) {
    reasons.push(`Teacher capacity ${totalCapacity.toFixed(1)}hrs < required 3.0hrs`);
  }
  
  return {
    feasible: reasons.length === 0,
    reasons,
    validBlocks,
    requiredBlocks: 1
  };
}


// Enhanced pickTeacher

function pickTeacher(teacherOptions, facultyMap, day, period, slotLoad, loadUsed) {
  for (const t of teacherOptions) {
    const faculty = facultyMap[t.value] || { slots: {} };
    if (isTeacherFree(faculty, day, period) && teacherHasLoad(faculty, t.label, slotLoad, loadUsed, t.value)) {
      return t;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 3: Structured failure reporting

function createFailureReport(subject, type, feasibilityResult, placedCount = 0) {
  const report = {
    subject: subject.subjectName.replace(/^\[.*?\]\s*/, ''),
    type,
    reasons: [...feasibilityResult.reasons]
  };
  
  if (type === 'theory') {
    report.required = subject.theoryPerWeek;
    report.placed = placedCount;
    if (placedCount > 0 && placedCount < subject.theoryPerWeek) {
      report.reasons.unshift(`Partially placed: ${placedCount}/${subject.theoryPerWeek} periods`);
    }
  } else {
    report.requiredBlocks = 1;
    report.placedBlocks = placedCount;
  }
  
  return report;
}

function formatFailureMessage(report) {
  const prefix = report.type === 'lab' ? ' LAB' : ' THEORY';
  let msg = `${prefix}: ${report.subject}`;
  
  if (report.type === 'theory') {
    if (report.placed > 0) {
      msg += ` — Placed ${report.placed}/${report.required} periods`;
    } else {
      msg += ` — Could not place any of ${report.required} periods`;
    }
  } else {
    msg += ` — Could not place lab block`;
  }
  
  if (report.reasons.length > 0) {
    msg += `\n   Reasons: ${report.reasons.join('; ')}`;
  }
  
  return msg;
}

// ENHANCED GENERATE ROUTINE

function generateRoutine(subjectRows, existingSlots, facultyMap, loadUsed) {
  const grid = {};
  DAYS.forEach(day => {
    grid[day] = {};
    ALL_PERIODS.forEach(p => {
      grid[day][p] = existingSlots[day]?.[p]
        ? { occupied: true, existing: true, data: existingSlots[day][p] }
        : { occupied: false };
    });
  });

  const failures = [];
  const isEdited = isEditedRoutine(existingSlots);

  const getDayOrder = () => isEdited ? [...DAYS] : [...DAYS].sort(() => Math.random() - 0.5);
  const getPeriodOrder = () => isEdited ? [...ALL_PERIODS] : [...ALL_PERIODS].sort(() => Math.random() - 0.5);
  const getLabSlotOrder = () => isEdited ? [...ALL_LAB_SLOTS] : [...ALL_LAB_SLOTS].sort(() => Math.random() - 0.5);

  
  // Step 1: Labs first
 
  const labSubjects = subjectRows.filter(r => r.isLab);
  
  for (const lab of labSubjects) {
    const subjectName = lab.subjectName.replace(/^\[.*?\]\s*/, '');
    
    const feasibility = checkLabFeasibility(lab, grid, facultyMap, loadUsed);
    if (!feasibility.feasible) {
      failures.push(createFailureReport(lab, 'lab', feasibility, 0));
      continue;
    }
    
    let placed = false;

    outer:
    for (const day of getDayOrder()) {
      for (const slots of getLabSlotOrder()) {
        if (!slots.every(p => !grid[day][p]?.occupied)) continue;
        
        const teacher = pickTeacher(lab.teacherOptions, facultyMap, day, slots[0], 3.0, loadUsed);
        if (!teacher) continue;
        
        const allFree = slots.every(p => isTeacherFree(facultyMap[teacher.value] || { slots: {} }, day, p));
        if (!allFree) continue;

        slots.forEach(p => {
          grid[day][p] = {
            occupied: true, isLab: true,
            subjectCode: lab.subjectId,
            subjectName,
            teacherId: teacher.value,
            teacherName: teacher.label,
            load: 1.0
          };
        });
        loadUsed[teacher.value] = (loadUsed[teacher.value] || 0) + 3.0;
        placed = true;
        break outer;
      }
    }

    if (!placed) {
      failures.push(createFailureReport(lab, 'lab', { reasons: ['Placement failed despite passing feasibility'] }, 0));
    }
  }

  
  // Step 2: Theory
 
  const theorySubjects = subjectRows.filter(r => !r.isLab);
  
  for (const theory of theorySubjects) {
    const subjectName = theory.subjectName.replace(/^\[.*?\]\s*/, '');
    
    const feasibility = checkTheoryFeasibility(theory, grid, facultyMap, loadUsed);
    if (!feasibility.feasible) {
      failures.push(createFailureReport(theory, 'theory', feasibility, 0));
      continue;
    }
    
    const periodsLeft = theory.theoryPerWeek;
    const placedDays = new Set();
    const lastPlacedPeriod = {};
    let placedCount = 0;

    for (let attempt = 0; attempt < periodsLeft; attempt++) {
      let placed = false;

      const dayOrder = getDayOrder().sort((a, b) => {
        const aHas = placedDays.has(a) ? 1 : 0;
        const bHas = placedDays.has(b) ? 1 : 0;
        if (isEdited) return aHas - bHas;
        return aHas - bHas || (Math.random() - 0.5);
      });

      for (const day of dayOrder) {
        if (placed) break;
        
        for (const period of getPeriodOrder()) {
          if (grid[day][period]?.occupied) continue;
          
          const lastP = lastPlacedPeriod[day];
          if (lastP && Math.abs(period - lastP) === 1) continue;

          const teacher = pickTeacher(theory.teacherOptions, facultyMap, day, period, 1.5, loadUsed);
          if (!teacher) continue;

          grid[day][period] = {
            occupied: true, isLab: false,
            subjectCode: theory.subjectId,
            subjectName,
            teacherId: teacher.value,
            teacherName: teacher.label,
            load: 1.5
          };
          loadUsed[teacher.value] = (loadUsed[teacher.value] || 0) + 1.5;
          placedDays.add(day);
          lastPlacedPeriod[day] = period;
          placedCount++;
          placed = true;
          break;
        }
      }

      if (!placed) {
        const currentFeasibility = checkTheoryFeasibility(theory, grid, facultyMap, loadUsed);
        failures.push(createFailureReport(theory, 'theory', currentFeasibility, placedCount));
        break;
      }
    }
  }

  return { grid, failures };
}

// REACT COMPONENT

function RoutineGenerator() {
  const [allRoutines, setAllRoutines] = useState([]);
  const [allSubjects, setAllSubjects] = useState([]);
  const [teachersCache, setTeachersCache] = useState({});
  const [routineRows, setRoutineRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [rSnap, sSnap] = await Promise.all([
          getDocs(collection(db, 'routines')),
          getDocs(collection(db, 'subjects'))
        ]);
        setAllRoutines(rSnap.docs.map(d => ({ id: d.id, ...d.data() })));
        setAllSubjects(sSnap.docs.map(d => ({ id: d.id, name: d.data().name || d.id })));
      } catch { setError('Failed to load data.'); }
    };
    load();
  }, []);

  const routineOptions = allRoutines.map(r => ({ value: r.id, label: r.name || r.id }));

  const loadTeachersForSubject = async (subjectId) => {
    if (teachersCache[subjectId]) return teachersCache[subjectId];
    const snap = await getDocs(collection(db, 'subjects', subjectId, 'teachers'));
    const teachers = {};
    snap.forEach(d => { teachers[d.id] = d.data().name || d.id; });
    setTeachersCache(prev => ({ ...prev, [subjectId]: teachers }));
    return teachers;
  };

  const addRoutineRow = () => {
    setRoutineRows(prev => [...prev, {
      id: Date.now(),
      selectedRoutine: null,
      subjects: [],
      activeChip: null,
      subjectPickerOpen: false
    }]);
  };

  const removeRoutineRow = (rowId) => {
    setRoutineRows(prev => prev.filter(r => r.id !== rowId));
  };

  const updateRoutineRow = (rowId, changes) => {
    setRoutineRows(prev => prev.map(r => r.id === rowId ? { ...r, ...changes } : r));
  };

  const handleAddSubject = async (rowId, option) => {
    if (!option) return;
    const teachers = await loadTeachersForSubject(option.value);
    const teacherOpts = Object.entries(teachers).map(([id, name]) => ({ value: id, label: name }));
    const isLab = isLabSubject(option.label);
    const newSubject = {
      id: Date.now(),
      subjectId: option.value,
      subjectName: option.label,
      isLab,
      theoryPerWeek: isLab ? 0 : 2,
      teacherOptions: teacherOpts
    };
    setRoutineRows(prev => prev.map(r => r.id === rowId ? {
      ...r,
      subjects: [...r.subjects, newSubject],
      activeChip: newSubject.id,
      subjectPickerOpen: false
    } : r));
  };

  const handleRemoveSubject = (rowId, subjectId) => {
    setRoutineRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      return {
        ...r,
        subjects: r.subjects.filter(s => s.id !== subjectId),
        activeChip: r.activeChip === subjectId ? null : r.activeChip
      };
    }));
  };

  const updateSubject = (rowId, subjectId, changes) => {
    setRoutineRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      return { ...r, subjects: r.subjects.map(s => s.id === subjectId ? { ...s, ...changes } : s) };
    }));
  };

  const validate = () => {
    if (routineRows.length === 0) return 'Add at least one routine.';
    for (const row of routineRows) {
      if (!row.selectedRoutine) return 'Select a routine for each row.';
      if (row.subjects.length === 0) return `Add at least one subject to ${row.selectedRoutine.label}.`;
      for (const sub of row.subjects) {
        if (sub.teacherOptions.length === 0) return `No teachers found for ${sub.subjectName}.`;
      }
    }
    return null;
  };

  const handleGenerate = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError('');
    setPreviews([]);
    setLoading(true);

    try {
      const allTeacherIds = new Set();
      routineRows.forEach(row => {
        row.subjects.forEach(sub => {
          sub.teacherOptions.forEach(t => allTeacherIds.add(t.value));
        });
      });

      const facultyMap = {};
      await Promise.all([...allTeacherIds].map(async (id) => {
        try {
          const [parentSnap, slotsSnap] = await Promise.all([
            getDoc(doc(db, 'Faculty_Routine', id)),
            getDocs(collection(db, 'Faculty_Routine', id, 'slots'))
          ]);
          const parentData = parentSnap.exists() ? parentSnap.data() : {};
          const slots = {};
          slotsSnap.forEach(d => { slots[d.id] = d.data(); });
          facultyMap[id] = { ...parentData, slots };
        } catch {
          facultyMap[id] = { slots: {} };
        }
      }));

      const loadUsed = {};
      const results = [];

      for (const row of routineRows) {
        const existingSlots = {};
        for (const day of DAYS) {
          const snap = await getDocs(collection(db, 'routines', row.selectedRoutine.value, day));
          existingSlots[day] = {};
          snap.forEach(d => { existingSlots[day][parseInt(d.id)] = d.data(); });
        }

        const { grid, failures } = generateRoutine(row.subjects, existingSlots, facultyMap, loadUsed);
        
        const formattedFailures = failures.map(formatFailureMessage);
        
        results.push({
          routineId: row.selectedRoutine.value,
          routineName: row.selectedRoutine.label,
          grid,
          failures: formattedFailures,
          isEdited: isEditedRoutine(existingSlots)
        });
      }

      setPreviews(results);
    } catch (err) {
      setError('Failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rg-page">
      <h2 className="rg-title">Routine Generator</h2>
      <p className="rg-subtitle">Add routines, configure subjects, then generate all at once.</p>

      {routineRows.map((row, rowIdx) => {
        const usedSubjectIds = row.subjects.map(s => s.subjectId);
        const availableSubjects = allSubjects
          .filter(s => !usedSubjectIds.includes(s.id))
          .map(s => ({ value: s.id, label: `[${s.id}] ${s.name}` }));

        const activeSubject = row.subjects.find(s => s.id === row.activeChip);

        return (
          <div key={row.id} className="rg-routine-card">
            <div className="rg-routine-header">
              <span className="rg-routine-title">Routine {rowIdx + 1}</span>
              <button className="rg-remove-btn" onClick={() => removeRoutineRow(row.id)}>✕ Remove</button>
            </div>

            <div className="rg-field">
              <label className="rg-label">Select Class Routine</label>
              <Select
                options={routineOptions.filter(opt =>
                  !routineRows.find(r => r.id !== row.id && r.selectedRoutine?.value === opt.value)
                )}
                value={row.selectedRoutine}
                onChange={(opt) => updateRoutineRow(row.id, { selectedRoutine: opt })}
                placeholder="Choose routine..."
                isClearable
              />
            </div>

            <div className="rg-field">
              <label className="rg-label">Subjects</label>
              <div className="rg-chip-bar">
                {row.subjects.map(sub => (
                  <div key={sub.id}
                    className={`rg-chip ${sub.isLab ? 'lab' : 'theory'} ${row.activeChip === sub.id ? 'active' : ''}`}
                    onClick={() => updateRoutineRow(row.id, { activeChip: row.activeChip === sub.id ? null : sub.id, subjectPickerOpen: false })}>
                    {sub.subjectName.replace(/^\[.*?\]\s*/, '')}
                    {sub.isLab && <span className="rg-lab-badge">LAB</span>}
                    <button className="rg-chip-x"
                      onClick={(e) => { e.stopPropagation(); handleRemoveSubject(row.id, sub.id); }}>✕</button>
                  </div>
                ))}

                {!row.subjectPickerOpen ? (
                  <button className="rg-add-chip"
                    onClick={() => updateRoutineRow(row.id, { subjectPickerOpen: true, activeChip: null })}>
                    + Add Subject
                  </button>
                ) : (
                  <div className="rg-subject-picker-wrapper">
                    <Select autoFocus options={availableSubjects}
                      onChange={(opt) => handleAddSubject(row.id, opt)}
                      placeholder="Search subject..." menuIsOpen
                      onBlur={() => updateRoutineRow(row.id, { subjectPickerOpen: false })} />
                  </div>
                )}
              </div>

              {activeSubject && (
                <div className="rg-panel">
                  <div className="rg-panel-title">
                    ⚙ {activeSubject.subjectName.replace(/^\[.*?\]\s*/, '')}
                    {activeSubject.isLab && <span className="rg-lab-badge">LAB</span>}
                  </div>

                  {activeSubject.isLab ? (
                    <p className="rg-panel-lab-note">
                      Lab = 3 consecutive periods. Teacher auto-selected from available list.
                    </p>
                  ) : (
                    <div className="rg-inline-row rg-field">
                      <label className="rg-inline-label">Classes/week:</label>
                      <input type="number" min={1} max={8} value={activeSubject.theoryPerWeek}
                        className="rg-num-input"
                        onChange={e => updateSubject(row.id, activeSubject.id, {
                          theoryPerWeek: parseInt(e.target.value) || 1
                        })} />
                    </div>
                  )}

                  <div className="rg-panel-teacher-info">
                    {activeSubject.teacherOptions.length} teacher(s) available — auto-selected during generation.
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <button className="rg-add-routine-btn" onClick={addRoutineRow}>+ Add Routine</button>

      {error && <div className="rg-error">{error}</div>}

      <button className="rg-generate-btn" onClick={handleGenerate} disabled={loading}>
        {loading ? (
          <div className="rg-loader-micro" title="Generating routine...">
            {[...Array(16)].map((_, i) => (
              <div 
                key={i}
                className="rg-loader-slot"
                style={{ 
                  animationDelay: `${(i % 4) * 0.15 + Math.floor(i / 4) * 0.1}s`,
                  background: i % 3 === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.25)'
                }} 
              />
            ))}
          </div>
        ) : (
          'Generate All Routines →'
        )}
      </button>

      {previews.length > 0 && (
        <div className="rg-preview-section">
          <h3 className="rg-preview-title">Preview</h3>
          {previews.map((preview) => (
            <div key={preview.routineId} className="rg-preview-routine">
              <div className="rg-preview-routine-name">
                {preview.routineName}
                {preview.isEdited && <span className="rg-edited-badge"> EDITED</span>}
              </div>

              {preview.failures.length > 0 && (
                <div className="rg-failures-container">
                  {preview.failures.map((f, i) => (
                    <div key={i} className="rg-fail">{f}</div>
                  ))}
                </div>
              )}

              <div className="rg-table-wrapper">
                <table className="rg-table">
                  <thead>
                    <tr>
                      <th>Day / Time</th>
                      {TIME_SLOTS.map((slot, i) => (
                        <th key={i} className={slot.isLunch ? 'lunch' : ''}>{slot.time}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map(day => (
                      <tr key={day}>
                        <td className="day-col">{DAY_LABELS[day]}</td>
                        {TIME_SLOTS.map((slot, i) => {
                          if (slot.isLunch) return <td key={i} className="lunch-col">Lunch</td>;
                          const cell = preview.grid[day]?.[slot.period];
                          if (!cell?.occupied) return <td key={i} className="empty-col">—</td>;
                          if (cell.existing) return (
                            <td key={i} className="existing-col">
                              <div className="rg-cell-subject existing">{cell.data?.sname || 'Existing'}</div>
                              <div className="rg-cell-teacher">{cell.data?.tname || ''}</div>
                            </td>
                          );
                          return (
                            <td key={i} className={cell.isLab ? 'lab-col' : 'theory-col'}>
                              <div className={`rg-cell-subject ${cell.isLab ? 'lab' : 'theory'}`}>
                                {cell.subjectName}
                              </div>
                              <div className="rg-cell-teacher">{cell.teacherName}</div>
                              {cell.isLab && <div className="rg-cell-lab-tag">LAB</div>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="rg-preview-legend">🟦 Theory &nbsp; 🟣 Lab &nbsp; 🟩 Existing</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default RoutineGenerator;