import { 
  GENERATOR_DAYS, 
  ALL_PERIODS, 
  ALL_LAB_SLOTS, 
  isTeacherFree, 
  teacherHasLoad, 
  isEditedRoutine,
  getDesignationLimit 
} from './routineUtils';

// Validates if a theory subject can physically fit into the weekly calendar schedule
function checkTheoryFeasibility(subjectRow, grid, facultyMap, loadUsed) {
  const required = subjectRow.theoryPerWeek;
  const reasons = [];
  let freeSlots = 0;
  let teacherAvailableSlots = 0;
  
  // Loops through each week day
  for (const day of GENERATOR_DAYS) {
    // Loops through each class time period
    for (const period of ALL_PERIODS) {
      // Counts empty slots in the grid matrix
      if (!grid[day][period]?.occupied) {
        freeSlots++;
        
        // Checks if at least one assigned teacher is free right now
        const hasAvailableTeacher = subjectRow.teacherOptions.some(t => {
          const faculty = facultyMap[t.value] || { slots: {} };
          return isTeacherFree(faculty, day, period) && 
                 teacherHasLoad(faculty, t.label, 1.5, loadUsed, t.value);
        });
        
        if (hasAvailableTeacher) teacherAvailableSlots++;
      }
    }
  }
  
  // Appends message if total blank grid spaces are too low
  if (freeSlots < required) {
    reasons.push(`Only ${freeSlots} free slots available, need ${required}`);
  }
  // Appends message if teacher schedule conflicts block the requirements
  if (teacherAvailableSlots < required) {
    reasons.push(`Only ${teacherAvailableSlots} slots with available teachers, need ${required}`);
  }
  
  // Adds up total teaching hours left across all optional teachers
  const totalCapacity = subjectRow.teacherOptions.reduce((sum, t) => {
    const faculty = facultyMap[t.value] || {};
    const limit = getDesignationLimit(t.label);
    const remaining = faculty.remainingLoad ?? limit;
    const used = loadUsed[t.value] || 0;
    return sum + Math.max(0, remaining - used);
  }, 0);
  
  // Checks if the accumulated work hours are enough for this class
  const requiredLoad = required * 1.5;
  if (totalCapacity < requiredLoad) {
    reasons.push(`Teacher capacity ${totalCapacity.toFixed(1)} workload < required ${requiredLoad.toFixed(1)} workload`);
  }
  
  return { feasible: reasons.length === 0, reasons };
}

// Validates if a three-period laboratory slot block is free and available
function checkLabFeasibility(subjectRow, grid, facultyMap, loadUsed) {
  const reasons = [];
  let validBlocks = 0;
  
  // Loops through days to find consecutive period slots
  for (const day of GENERATOR_DAYS) {
    for (const slots of ALL_LAB_SLOTS) {
      // Verifies that all three continuous slots are completely empty
      if (!slots.every(p => !grid[day][p]?.occupied)) continue;
      
      // Verifies that a teacher can cover the entire uninterrupted time block
      const hasAvailableTeacher = subjectRow.teacherOptions.some(t => {
        const faculty = facultyMap[t.value] || { slots: {} };
        const allFree = slots.every(p => isTeacherFree(faculty, day, p));
        const hasLoad = teacherHasLoad(faculty, t.label, 3.0, loadUsed, t.value);
        return allFree && hasLoad;
      });
      
      if (hasAvailableTeacher) validBlocks++;
    }
  }
  
  // Logs diagnostic issues if zero lab blocks could be safely structured
  if (validBlocks === 0) {
    reasons.push('No 3-consecutive free periods available');
    let hasEmptyBlocks = false;
    
    for (const day of GENERATOR_DAYS) {
      for (const slots of ALL_LAB_SLOTS) {
        if (slots.every(p => !grid[day][p]?.occupied)) {
          hasEmptyBlocks = true;
          break;
        }
      }
      if (hasEmptyBlocks) break;
    }
    
    // Notes if the block failure is from teacher limits or lack of grid room
    if (hasEmptyBlocks) {
      reasons.push('Free blocks exist but no teacher available for full duration');
    }
  }
  
  // Accumulates remaining hours left across available pool teachers
  const totalCapacity = subjectRow.teacherOptions.reduce((sum, t) => {
    const faculty = facultyMap[t.value] || {};
    const limit = getDesignationLimit(t.label);
    const remaining = faculty.remainingLoad ?? limit;
    const used = loadUsed[t.value] || 0;
    return sum + Math.max(0, remaining - used);
  }, 0);
  
  // Checks if the teachers have at least three hours of work capacity left
  if (totalCapacity < 3.0) {
    reasons.push(`Teacher capacity ${totalCapacity.toFixed(1)}hrs < required 3.0hrs`);
  }
  
  return { feasible: reasons.length === 0, reasons };
}

// Formats validation errors into organized object payloads for reporting
function createFailureReport(subject, type, feasibilityResult, placedCount = 0) {
  const report = {
    // Standardizes text names by clearing identifier bracket flags
    subject: subject.subjectName.replace(/^\[.*?\]\s*/, ''),
    type,
    reasons: [...feasibilityResult.reasons]
  };
  
  // Attaches specific completion records if evaluating theory classes
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

// Formats raw data error reports into neat text strings for UI messages
export function formatFailureMessage(report) {
  const prefix = report.type === 'lab' ? ' LAB' : ' THEORY';
  let msg = `${prefix}: ${report.subject}`;
  if (report.type === 'theory') {
    msg += report.placed > 0 ? ` — Placed ${report.placed}/${report.required} periods` : ` — Could not place any of ${report.required} periods`;
  } else {
    msg += ` — Could not place lab block`;
  }
  if (report.reasons.length > 0) msg += `\n   Reasons: ${report.reasons.join('; ')}`;
  return msg;
}

// Scans instructor list to select an available teacher matching parameters
function pickTeacher(teacherOptions, facultyMap, day, period, slotLoad, loadUsed, preferredTeacher = null) {
  // Checks if manual preferred choice satisfies current grid availability
  if (preferredTeacher) {
    const faculty = facultyMap[preferredTeacher.value] || { slots: {} };
    if (isTeacherFree(faculty, day, period) && teacherHasLoad(faculty, preferredTeacher.label, slotLoad, loadUsed, preferredTeacher.value)) {
      return preferredTeacher;
    }
  }
  
  // Iterates safely through backup choices if priority choice is blocked
  for (const t of teacherOptions) {
    if (preferredTeacher && t.value === preferredTeacher.value) continue;
    const faculty = facultyMap[t.value] || { slots: {} };
    if (isTeacherFree(faculty, day, period) && teacherHasLoad(faculty, t.label, slotLoad, loadUsed, t.value)) {
      return t;
    }
  }
  return null;
}

// Core generation script executing schedule balancing and automated mapping tasks
export function generateRoutine(subjectRows, existingSlots, facultyMap, loadUsed) {
  const grid = {};
  
  // Creates initial blank time map layout tracking points
  GENERATOR_DAYS.forEach(day => {
    grid[day] = {};
    ALL_PERIODS.forEach(p => {
      // Imports pre-saved locked slots to shield them from overwrite drops
      grid[day][p] = existingSlots[day]?.[p]
        ? { occupied: true, existing: true, data: existingSlots[day][p] }
        : { occupied: false };
    });
  });

  const failures = [];
  const isEdited = isEditedRoutine(existingSlots);

  // Provides dynamic random sorting functions to naturally vary generated layouts
  const getDayOrder = () => isEdited ? [...GENERATOR_DAYS] : [...GENERATOR_DAYS].sort(() => Math.random() - 0.5);
  const getPeriodOrder = () => isEdited ? [...ALL_PERIODS] : [...ALL_PERIODS].sort(() => Math.random() - 0.5);
  const getLabSlotOrder = () => isEdited ? [...ALL_LAB_SLOTS] : [...ALL_LAB_SLOTS].sort(() => Math.random() - 0.5);

  // Filters and processes laboratory subjects first due to high constraint limits
  const labSubjects = subjectRows.filter(r => r.isLab);
  for (const lab of labSubjects) {
    const subjectName = lab.subjectName.replace(/^\[.*?\]\s*/, '');
    const feasibility = checkLabFeasibility(lab, grid, facultyMap, loadUsed);
    if (!feasibility.feasible) {
      failures.push(createFailureReport(lab, 'lab', feasibility, 0));
      continue;
    }
    
    let placed = false;
    outer: for (const day of getDayOrder()) {
      for (const slots of getLabSlotOrder()) {
        if (!slots.every(p => !grid[day][p]?.occupied)) continue;
        const teacher = pickTeacher(lab.teacherOptions, facultyMap, day, slots[0], 3.0, loadUsed, lab.preferredTeacher);
        if (!teacher) continue;

        // Allocates all three consecutive periods to the same subject block
        slots.forEach(p => {
          grid[day][p] = {
            occupied: true, isLab: true,
            subjectCode: lab.subjectId, subjectName,
            teacherId: teacher.value, teacherName: teacher.label,
            load: 1.0
          };
        });
        // Records the processed workload assignment into runtime tracking map
        loadUsed[teacher.value] = (loadUsed[teacher.value] || 0) + 3.0;
        placed = true;
        break outer;
      }
    }
    if (!placed) failures.push(createFailureReport(lab, 'lab', { reasons: ['Placement failed despite passing feasibility'] }, 0));
  }

  // Filters and distributes standard text book theory classes second
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

    // Distributes individual classes day by day up to required targets
    for (let attempt = 0; attempt < periodsLeft; attempt++) {
      let placed = false;
      // Re-orders processing pathways to prioritize days that lack this class
      const dayOrder = getDayOrder().sort((a, b) => (placedDays.has(a) ? 1 : 0) - (placedDays.has(b) ? 1 : 0));

      for (const day of dayOrder) {
        if (placed) break;
        for (const period of getPeriodOrder()) {
          if (grid[day][period]?.occupied) continue;
          
          // Prevents placing the same subject in consecutive back to back periods on a single day
          if (lastPlacedPeriod[day] && Math.abs(period - lastPlacedPeriod[day]) === 1) continue;

          const teacher = pickTeacher(theory.teacherOptions, facultyMap, day, period, 1.5, loadUsed, theory.preferredTeacher);
          if (!teacher) continue;

          // Writes verified scheduling data keys safely into the local grid map layer
          grid[day][period] = {
            occupied: true, isLab: false,
            subjectCode: theory.subjectId, subjectName,
            teacherId: teacher.value, teacherName: teacher.label,
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
      
      // Handles edge state situations where random paths lock out valid selections
      if (!placed) {
        failures.push(createFailureReport(theory, 'theory', { reasons: ['No remaining compatible timeline options found'] }, placedCount));
        break;
      }
    }
  }

  return { grid, failures };
}