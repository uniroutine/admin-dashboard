/**
 * Static configuration mappings and helper utilities for scheduling parameters.
 * Maintains structural integrity across components by supplying identical constant definitions.
 */

// Full string descriptors used primarily for rendering UI elements and labels
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Shortened keys corresponding to subcollection configurations inside Firestore database
export const DAYS_TO_FETCH = ['mon', 'tue', 'wed', 'thu', 'fri'];

// Translation map to transition from user-facing UI labels to backend search queries
export const DAY_TO_KEY = {
  'Monday': 'mon',
  'Tuesday': 'tue',
  'Wednesday': 'wed',
  'Thursday': 'thu',
  'Friday': 'fri'
};

// Chronological timeline structure defining periods, timestamps, and lunch allocations
export const TIME_SLOTS = [
  { period: 1, time: '9:00 - 9:50' },
  { period: 2, time: '9:50 - 10:40' },
  { period: 3, time: '10:40 - 11:30' },
  { period: 4, time: '11:30 - 12:20' },
  { period: 5, time: '12:20 - 1:00', isLunch: true }, // Structural lunch break gap
  { period: 6, time: '1:00 - 1:50' },
  { period: 7, time: '1:50 - 2:40' },
  { period: 8, time: '2:40 - 3:30' },
  { period: 9, time: '3:30 - 4:20' }
];

// Shortened day key references dedicated to handling bulk scheduling variations within the generator module
export const GENERATOR_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

// Reverse translation map transforming stored shorthand keys back into formal strings for previews
export const DAY_LABELS = { 
  mon: 'Monday', 
  tue: 'Tuesday', 
  wed: 'Wednesday', 
  thu: 'Thursday', 
  fri: 'Friday' 
};

// Valid array containing numbers of regular teaching periods, intentionally skipping period 5 (lunch break)
export const ALL_PERIODS = [1, 2, 3, 4, 6, 7, 8, 9];

// Multi-dimensional array specifying exact configurations of consecutive period ranges reserved for laboratory setups
export const ALL_LAB_SLOTS = [[1, 2, 3], [2, 3, 4], [6, 7, 8], [7, 8, 9]];

/**
 * Derives designation labels and weekly limit maximum hour thresholds 
 * based on string parsing matches found within the instructor's name string.
 * Used for calculation profiles, validations, and workload summaries.
 * @param {string} teacherName
 * @returns {{ label: string, limit: number }}
 */
export function getDesignationLimit(teacherName = '') {
  const nameLower = teacherName.toLowerCase();
  
  // Parse for assistant designation status matches
  if (nameLower.includes('asst.') || nameLower.includes('assistant')) {
    return { label: 'Assistant Professor', limit: 24 };
  }
  // Parse for associate designation status matches
  if (nameLower.includes('assoc.') || nameLower.includes('associate')) {
    return { label: 'Associate Professor', limit: 12 };
  }
  // Parse for full professor designation status matches
  if (nameLower.includes('prof.') || nameLower.includes('professor')) {
    return { label: 'Professor', limit: 8 };
  }
  
  // Standard structural fallback properties when explicit designations are missing
  return { label: 'Associate Professor (default)', limit: 12 };
}

/**
 * Explicit helper to extract designation labels independently for UI summaries.
 * Prevents runtime application failures when companion components look for explicit descriptions.
 * @param {string} teacherName
 * @returns {{ label: string }}
 */
export function getDesignationInfo(teacherName = '') {
  const info = getDesignationLimit(teacherName);
  return { label: info.label };
}

/**
 * Checks a subject name string to identify if it denotes a laboratory curriculum block.
 * Uses regex parsing looking for exact word bounds.
 * @param {string} name
 * @returns {boolean} True if classified as lab environment
 */
export function isLabSubject(name = '') {
  return /\blab\b|\blaboratory\b/i.test(name);
}

/**
 * Validates whether an instructor is clear of schedule tasks for a specific date time string.
 * Checks the existing slots subcollection retrieved from Firestore profiles.
 * @param {object} facultyData - Complete map containing active allocations
 * @param {string} dayKey - Key name of target day (e.g., 'mon')
 * @param {number} period - Target period number
 * @returns {boolean} True if slot is vacant for new assignments
 */
export function isTeacherFree(facultyData, dayKey, period) {
  return !facultyData?.slots?.[`${dayKey}_${period}`];
}

/**
 * Verifies if an instructor possesses sufficient teaching capacity to handle an additional load block.
 * Compares contractual hour bounds against currently saved values plus uncommitted buffer spaces.
 * @param {object} facultyData - Target instructor structural details
 * @param {string} teacherName - Used to parse out profile designations if limits are unspecified
 * @param {number} slotLoad - Target hour weight to inject (e.g., 1.5 or 3.0)
 * @param {object} loadUsed - Local tracking dictionary monitoring current state loop executions
 * @param {string} teacherId - System key string for checking tracking maps
 * @returns {boolean} True if the calculated assignment fits within maximum limits
 */
export function teacherHasLoad(facultyData, teacherName, slotLoad, loadUsed, teacherId) {
  // Extract maximum capabilities
  const limit = getDesignationLimit(teacherName).limit;
  
  // Prioritize active database snapshots, falling back to basic metadata limits
  const remaining = facultyData?.remainingLoad ?? limit;
  
  // Factor in pending session calculations accumulated during active iteration passes
  const used = loadUsed[teacherId] || 0;
  
  // Assess final remaining capacity metrics
  return (remaining - used) >= slotLoad;
}

/**
 * Evaluation check determining whether a timeline model contains pre-existing manually assigned elements.
 * Helps prevent randomization processes from wiping out customized priority updates.
 * @param {object} existingSlots - Complete collection map of active grid rows
 * @returns {boolean} True if structural slot properties contain data
 */
export function isEditedRoutine(existingSlots) {
  for (const day of GENERATOR_DAYS) {
    // Scan daily objects to verify active structural tasks exist
    if (existingSlots[day] && Object.keys(existingSlots[day]).length > 0) {
      return true;
    }
  }
  return false;
}