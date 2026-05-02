import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase";

import {
    collection,
    doc,
    setDoc,
    addDoc,
    getDocs,
    getDoc
} from "firebase/firestore";
import "./AddData.css";
import Select from 'react-select';
export default function AddData() {
    // --- Subjects ---
    const [subjectCode, setSubjectCode] = useState("");
    const [subjectName, setSubjectName] = useState("");
    const [allSubjects, setAllSubjects] = useState([]);

    // --- Teachers ---
    const [teacherSubject, setTeacherSubject] = useState("");
    const [teacherName, setTeacherName] = useState("");
    const [teacherDesignation, setTeacherDesignation] = useState("Prof."); // ← from Doc 2

    // --- Routines ---
    const [routineId, setRoutineId] = useState("");
    const [routineName, setRoutineName] = useState("");
    const [selectedRoutineId, setSelectedRoutineId] = useState("");
    const [routineList, setRoutineList] = useState([]);

    // --- Excel import ---
    const [excelFile, setExcelFile] = useState(null);
    const [excelPreviewCount, setExcelPreviewCount] = useState(null);

    // --- UI state ---
    const [status, setStatus] = useState("");
    const [saving, setSaving] = useState(false);
    const [loadingSubjects, setLoadingSubjects] = useState(false);
    const [loadingRoutines, setLoadingRoutines] = useState(false);

// --- for teacher link to multiple subjects ---
    const [assignTeacher, setAssignTeacher] = useState(null);
const [assignSubject, setAssignSubject] = useState("");
const [allTeachers, setAllTeachers] = useState([]);
const [loadingTeachers, setLoadingTeachers] = useState(false);

    // -----------------------
    // Helpers
    // -----------------------
    const isSignedIn = () => !!auth.currentUser;

    const simpleErr = (err) => (err?.code === "permission-denied"
        ? "Permission denied. Check your auth/roles."
        : err?.message || String(err));

    const isValidId = (id) => id && !id.includes("/");

    // -----------------------
    // Load existing data
    // -----------------------
    const loadSubjects = async () => {
        setLoadingSubjects(true);
        try {
            const snap = await getDocs(collection(db, "subjects"));
            const items = snap.docs.map(d => ({ id: d.id, name: d.data()?.name || "" }));
            setAllSubjects(items.sort((a, b) => a.id.localeCompare(b.id)));
        } catch (err) {
            setStatus("Failed to load subjects: " + simpleErr(err));
        } finally {
            setLoadingSubjects(false);
        }
    };

    const loadRoutines = async () => {
        setLoadingRoutines(true);
        try {
            const snap = await getDocs(collection(db, "routines"));
            const items = snap.docs.map(d => ({ id: d.id, name: d.data()?.name || "" }));
            setRoutineList(items.sort((a, b) => a.id.localeCompare(b.id)));
        } catch (err) {
            setStatus("Failed to load routines: " + simpleErr(err));
        } finally {
            setLoadingRoutines(false);
        }
    };
    const loadAllTeachers = async () => {
    setLoadingTeachers(true);
    try {
        const snap = await getDocs(collection(db, "Faculty_Routine"));
        const teachers = snap.docs.map(d => ({
            id: d.id,
            name: d.data().teacherName || d.id
        }));
        setAllTeachers(teachers.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
        setStatus("Failed to load teachers: " + simpleErr(err));
    } finally {
        setLoadingTeachers(false);
    }
};

    useEffect(() => {
        loadSubjects();
        loadRoutines();
        loadAllTeachers(); 
    }, []);


 const handleAssignTeacher = async (e) => {
    e?.preventDefault();
    if (!assignTeacher) return setStatus("Select a teacher.");
    if (!assignSubject) return setStatus("Select a subject.");
    if (!isSignedIn()) return setStatus("You must be signed in.");

    setSaving(true);
    setStatus("");
    try {
        // Check if teacher already assigned to this subject
        const teachersRef = collection(db, "subjects", assignSubject, "teachers");
        const existingSnap = await getDocs(teachersRef);
        const alreadyExists = existingSnap.docs.some(d => d.id === assignTeacher.value);

        if (alreadyExists) {
            setStatus(`${assignTeacher.label} is already assigned to this subject.`);
            return;
        }

        // Use setDoc with same teacher ID
        await setDoc(
            doc(db, "subjects", assignSubject, "teachers", assignTeacher.value),
            { name: assignTeacher.label }
        );

        setStatus(`✓ ${assignTeacher.label} assigned to ${assignSubject}.`);
        setAssignTeacher(null);
        setAssignSubject("");
    } catch (err) {
        setStatus("Error assigning teacher: " + simpleErr(err));
    } finally {
        setSaving(false);
    }
};
    // -----------------------
    // Subject handlers
    // -----------------------
    const handleSubjectSave = async (e) => {
        e?.preventDefault();
        const code = subjectCode.trim();
        const name = subjectName.trim();
        if (!isValidId(code)) return setStatus("Subject code required and cannot contain '/'.");
        if (!name) return setStatus("Subject name required.");
        if (!isSignedIn()) return setStatus("You must be signed in to save subjects.");

        setSaving(true);
        setStatus("");
        try {
            await setDoc(doc(db, "subjects", code), { name }, { merge: true });
            setStatus(`Subject ${code} saved.`);
            setSubjectCode("");
            setSubjectName("");
            await loadSubjects();
        } catch (err) {
            setStatus("Error saving subject: " + simpleErr(err));
        } finally {
            setSaving(false);
        }
    };

    // -----------------------
    // Teacher handlers
    // -----------------------
    const handleTeacherSave = async (e) => {
    e?.preventDefault();
    if (!teacherSubject) return setStatus("Choose a subject for the teacher.");
    const tname = teacherName.trim();
    if (!tname) return setStatus("Teacher name required.");
    if (!isSignedIn()) return setStatus("You must be signed in to add teachers.");

    setSaving(true);
    setStatus("");
    try {
        const fullName = `${teacherDesignation} ${tname}`;

        // Step 1: Add to subjects — capture the generated ID
        const teachersRef = collection(db, "subjects", teacherSubject, "teachers");
        const newDoc = await addDoc(teachersRef, { name: fullName });
        const teacherId = newDoc.id;

        // Step 2: Register in Faculty_Routine with SAME ID — only if not already there
        const facultyRef = doc(db, "Faculty_Routine", teacherId);
        const facultySnap = await getDoc(facultyRef);
        if (!facultySnap.exists()) {
            // Detect limit from name using existing regex logic
            const n = fullName.toLowerCase();
            const limit = n.includes('asst.') || n.includes('assistant') ? 24
                        : n.includes('assoc.') || n.includes('associate') ? 12
                        : n.includes('prof.') || n.includes('professor') ? 8
                        : 12;

            await setDoc(facultyRef, {
                teacherName: fullName,
                maxLoad: limit,
                remainingLoad: limit
            });
        }

        setStatus(`Teacher '${fullName}' added and registered.`);
        setTeacherName("");
        await loadSubjects();
    } catch (err) {
        setStatus("Error adding teacher: " + simpleErr(err));
    } finally {
        setSaving(false);
    }
};

    // -----------------------
    // Routine handlers
    // -----------------------
    const handleRoutineCreate = async (e) => {
        e?.preventDefault();
        const id = routineId.trim();
        if (!isValidId(id)) return setStatus("Routine ID required and cannot contain '/'.");
        if (!isSignedIn()) return setStatus("You must be signed in to create routines.");

        setSaving(true);
        setStatus("");
        try {
            await setDoc(doc(db, "routines", id), { createdAt: new Date().toISOString() }, { merge: true });
            setStatus(`Created/updated routine ${id}`);
            setRoutineId("");
            await loadRoutines();
        } catch (err) {
            setStatus("Error creating routine: " + simpleErr(err));
        } finally {
            setSaving(false);
        }
    };

    const handleRoutineSetName = async (e) => {
        e?.preventDefault();
        const id = (selectedRoutineId || routineId).trim();
        const name = routineName.trim();
        if (!isValidId(id)) return setStatus("Choose or type a valid routine ID (no slashes).");
        if (!name) return setStatus("Routine name required.");
        if (!isSignedIn()) return setStatus("You must be signed in to edit routines.");

        setSaving(true);
        setStatus("");
        try {
            await setDoc(doc(db, "routines", id), { name }, { merge: true });
            setStatus(`Set name for ${id}`);
            setRoutineName("");
            setRoutineId("");
            setSelectedRoutineId("");
            await loadRoutines();
        } catch (err) {
            setStatus("Error setting routine name: " + simpleErr(err));
        } finally {
            setSaving(false);
        }
    };

    // -----------------------
    // Excel import (lazy)
    // -----------------------
    const handleExcelFileChange = (evt) => {
        const f = evt.target.files?.[0];
        if (!f) { setExcelFile(null); setExcelPreviewCount(null); return; }
        setExcelFile(f);
        setExcelPreviewCount(null);
        setStatus("");
    };

    const handleExcelPreview = async () => {
        if (!excelFile) return setStatus("Select an Excel file first.");
        setStatus("Reading Excel (preview)...");
        try {
            const ExcelJS = await import("exceljs");
            const wb = new ExcelJS.Workbook();
            const buffer = await excelFile.arrayBuffer();
            await wb.xlsx.load(buffer);
            const ws = wb.worksheets[0];
            if (!ws) return setStatus("No worksheet found.");
            let rows = 0;
            ws.eachRow(() => rows++);
            setExcelPreviewCount(Math.max(0, rows - 1));
            setStatus(`Preview: ${Math.max(0, rows - 1)} data rows found.`);
        } catch (err) {
            setStatus("Error reading Excel: " + simpleErr(err));
        }
    };

   const handleExcelImport = async () => {
    if (!excelFile) return setStatus("Select an Excel file first.");
    if (!isSignedIn()) return setStatus("You must be signed in to import data.");
    
    setSaving(true);
    setStatus("Importing...");
    try {
        const ExcelJS = await import("exceljs");
        const wb = new ExcelJS.Workbook();
        const buffer = await excelFile.arrayBuffer();
        await wb.xlsx.load(buffer);
        const ws = wb.worksheets[0];
        if (!ws) throw new Error("No worksheet found");

        const header = [];
        ws.getRow(1).eachCell((cell, colNumber) => {
            header[colNumber - 1] = String(cell.value || "").toLowerCase().trim();
        });

        // Fixed header detection
        const codeIdx = header.findIndex(h => h === "subject code" || h === "code") + 1;
        const nameIdx = header.findIndex(h => h === "subject name" || (h.includes("name") && !h.includes("code"))) + 1;
        const teacherIdx = header.findIndex(h => h === "teacher name" || h === "teacher") + 1;

        if (!codeIdx || !nameIdx) throw new Error("Excel must include Subject Code and Subject Name columns");

        // Deduplicate in-memory first
        const subjectMap = new Map(); // code -> name
        const teacherSetMap = new Map(); // code -> Set of teacher names

        ws.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const code = String(row.getCell(codeIdx).value || "").trim();
            const name = String(row.getCell(nameIdx).value || "").trim();
            const teacher = teacherIdx ? String(row.getCell(teacherIdx).value || "").trim() : "";
            if (!code || !name) return;

            if (!subjectMap.has(code)) subjectMap.set(code, name);
            if (teacher) {
                if (!teacherSetMap.has(code)) teacherSetMap.set(code, new Set());
                teacherSetMap.get(code).add(teacher);
            }
        });

        let success = 0, failed = 0, teacherSuccess = 0, teacherSkipped = 0;

        for (const [code, name] of subjectMap) {
            try {
                await setDoc(doc(db, "subjects", code), { name }, { merge: true });
                success++;
            } catch (err) {
                failed++;
            }
        }

        for (const [code, teachers] of teacherSetMap) {
            const teachersRef = collection(db, "subjects", code, "teachers");
            // Check what already exists in Firestore
            const existingSnap = await getDocs(teachersRef);
            const existing = new Set(existingSnap.docs.map(d => d.data().name));

            for (const teacher of teachers) {
                if (existing.has(teacher)) { teacherSkipped++; continue; }
                try {
                    await addDoc(teachersRef, { name: teacher });
                    teacherSuccess++;
                } catch (err) {
                    failed++;
                }
            }
        }

        await loadSubjects();
        setStatus(`Import done: ${success} subjects, ${teacherSuccess} teachers added, ${teacherSkipped} skipped (duplicates)`);
        setExcelFile(null);
        setExcelPreviewCount(null);
    } catch (err) {
        setStatus("Excel import error: " + simpleErr(err));
    } finally {
        setSaving(false);
    }
};

    // -----------------------
    // Render
    // -----------------------
    return (
        <div className="add-data-root">
            <h1 className="page-title">Add Data</h1>

            <div className="grid">
                {/* Column 1: Subjects */}
                <section className="card column">
                    <h3>Subject — Add / Update</h3>
                    <form onSubmit={handleSubjectSave} className="form-stack">
                        <label>Subject Code (ID)</label>
                        <input value={subjectCode} onChange={e => setSubjectCode(e.target.value)} placeholder="e.g. CS101" />
                        <label>Subject Name</label>
                        <input value={subjectName} onChange={e => setSubjectName(e.target.value)} placeholder="e.g. Intro to Programming" />
                        <button type="submit" disabled={saving}>Save Subject</button>
                    </form>

                    <hr />

                    <div className="import-section">
                        <label>Import Subjects from Excel (optional)</label>
                        <input type="file" accept=".xlsx" onChange={handleExcelFileChange} />
                        <div className="import-actions">
                            <button onClick={handleExcelPreview} disabled={!excelFile || saving}>Preview</button>
                            <button onClick={handleExcelImport} disabled={!excelFile || saving}>Import</button>
                        </div>
                        {excelPreviewCount !== null && <div className="hint">Preview rows: {excelPreviewCount}</div>}
                    </div>
                </section>

                {/* Column 2: Teachers */}
                <section className="card column">
                    <h3>Teacher — Add</h3>
                    <form onSubmit={handleTeacherSave} className="form-stack">
                        <label>Select Subject</label>
                        <select value={teacherSubject} onChange={e => setTeacherSubject(e.target.value)} disabled={loadingSubjects}>
                            <option value="">-- choose subject --</option>
                            {allSubjects.map(s => <option key={s.id} value={s.id}>{s.id}{s.name ? ` — ${s.name}` : ""}</option>)}
                        </select>

                        <label>Designation</label>
                        <select value={teacherDesignation} onChange={e => setTeacherDesignation(e.target.value)}>
                            <option value="Prof.">Professor</option>
                            <option value="Assoc. Prof.">Associate Professor</option>
                            <option value="Asst. Prof.">Assistant Professor</option>
                        </select>

                        <label>Teacher Name</label>
                        <input value={teacherName} onChange={e => setTeacherName(e.target.value)} placeholder="e.g. Ada Lovelace" />

                        <button type="submit" disabled={saving}>Add Teacher</button>
                    </form>
                    <div className="note">Teachers are stored under <code>subjects/&lt;code&gt;/teachers</code>.</div>
                </section>

                {/* Column 3: Routines */}
                <section className="card column">
                    <h3>Routine — Create / Name</h3>
                    <form onSubmit={handleRoutineCreate} className="form-stack">
                        <label>New Routine ID</label>
                        <input value={routineId} onChange={e => setRoutineId(e.target.value)} placeholder="e.g. IT1" />
                        <button type="submit" disabled={saving}>Add Routine ID</button>
                    </form>

                    <hr />

                    <form onSubmit={handleRoutineSetName} className="form-stack">
                        <label>Choose Routine</label>
                        <select value={selectedRoutineId} onChange={e => setSelectedRoutineId(e.target.value)} disabled={loadingRoutines}>
                            <option value="">-- choose existing routine --</option>
                            {routineList.map(r => <option key={r.id} value={r.id}>{r.id}{r.name ? ` — ${r.name}` : ""}</option>)}
                        </select>

                        <label>Or type an ID</label>
                        <input value={routineId} onChange={e => setRoutineId(e.target.value)} placeholder="or type routine id" />

                        <label>Routine Name</label>
                        <input value={routineName} onChange={e => setRoutineName(e.target.value)} placeholder="e.g. First Semester" />

                        <button type="submit" disabled={saving}>Set Routine Name</button>
                    </form>
                </section>


                {/* Column 4: Assign Teacher to Subject */}
<section className="card column">
    <h3>Assign Teacher to Subject</h3>
    <form onSubmit={handleAssignTeacher} className="form-stack">
        <label>Select Teacher</label>
        <Select
            options={allTeachers.map(t => ({ value: t.id, label: t.name }))}
            value={assignTeacher}
            onChange={setAssignTeacher}
            isLoading={loadingTeachers}
            placeholder="Select teacher..."
            isClearable
        />

        <label>Select Subject</label>
        <select
            value={assignSubject}
            onChange={e => setAssignSubject(e.target.value)}
            disabled={loadingSubjects}
        >
            <option value="">-- choose subject --</option>
            {allSubjects.map(s => (
                <option key={s.id} value={s.id}>
                    {s.id}{s.name ? ` — ${s.name}` : ""}
                </option>
            ))}
        </select>

        <button type="submit" disabled={saving}>Assign Teacher</button>
    </form>
    <div className="note">
        Teacher will be linked using their existing ID — no duplicates created.
    </div>
</section>
            </div>

            <div className="status-bar">{status}</div>
        </div>
    );
}