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
    const [teacherDesignation, setTeacherDesignation] = useState("Prof.");

    // --- Routines ---
    const [routineId, setRoutineId] = useState("");
    const [routineName, setRoutineName] = useState("");
    const [selectedRoutineId, setSelectedRoutineId] = useState("");
    const [routineList, setRoutineList] = useState([]);

    // --- Excel import (subjects) ---
    const [excelFile, setExcelFile] = useState(null);
    const [excelPreviewCount, setExcelPreviewCount] = useState(null);

    // --- Excel import (teachers) ---
    const [teacherExcelFile, setTeacherExcelFile] = useState(null);
    const [teacherExcelPreviewCount, setTeacherExcelPreviewCount] = useState(null);
    const [teacherExcelPreviewData, setTeacherExcelPreviewData] = useState(null);

    // --- UI state ---
    const [status, setStatus] = useState("");
    const [saving, setSaving] = useState(false);
    const [loadingSubjects, setLoadingSubjects] = useState(false);
    const [loadingRoutines, setLoadingRoutines] = useState(false);

    // --- Assign teacher to multiple subjects ---
    const [assignTeacher, setAssignTeacher] = useState(null);
    const [assignSubjects, setAssignSubjects] = useState([]);
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

    const getTeachingLoad = (fullName) => {
        const n = fullName.toLowerCase();
        if (n.includes('asst.') || n.includes('assistant')) return 24;
        if (n.includes('assoc.') || n.includes('associate')) return 12;
        if (n.includes('prof.') || n.includes('professor')) return 8;
        return 12;
    };

    const findTeacherByName = async (teacherName) => {
        const facultySnap = await getDocs(collection(db, "Faculty_Routine"));
        return facultySnap.docs.find(d =>
            d.data().teacherName?.toLowerCase().trim() === teacherName.toLowerCase().trim()
        );
    };

    const ensureTeacherInFaculty = async (fullName) => {
        const existingTeacher = await findTeacherByName(fullName);
        if (existingTeacher) return existingTeacher.id;

        const limit = getTeachingLoad(fullName);
        const newTeacherRef = doc(collection(db, "Faculty_Routine"));
        await setDoc(newTeacherRef, {
            teacherName: fullName,
            maxLoad: limit,
            remainingLoad: limit
        });
        return newTeacherRef.id;
    };

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

    // -----------------------
    // Assign Teacher to Multiple Subjects
    // -----------------------
    const handleAssignTeacherToMultipleSubjects = async (e) => {
        e?.preventDefault();
        if (!assignTeacher) return setStatus("Select a teacher.");
        if (!assignSubjects || assignSubjects.length === 0) return setStatus("Select at least one subject.");
        if (!isSignedIn()) return setStatus("You must be signed in.");

        setSaving(true);
        setStatus("");
        try {
            let assigned = 0;
            let skipped = 0;
            const errors = [];

            for (const subject of assignSubjects) {
                try {
                    const teachersRef = collection(db, "subjects", subject.value, "teachers");
                    const existingSnap = await getDocs(teachersRef);
                    const alreadyExists = existingSnap.docs.some(d => d.id === assignTeacher.value);

                    if (alreadyExists) {
                        skipped++;
                        continue;
                    }

                    await setDoc(
                        doc(db, "subjects", subject.value, "teachers", assignTeacher.value),
                        { name: assignTeacher.label }
                    );
                    assigned++;
                } catch (err) {
                    errors.push(`${subject.label}: ${simpleErr(err)}`);
                }
            }

            let msg = `${assignTeacher.label} assigned to ${assigned} subject(s)`;
            if (skipped > 0) msg += `, ${skipped} skipped (already assigned)`;
            if (errors.length > 0) msg += `\nErrors: ${errors.join(', ')}`;

            setStatus(msg);
            setAssignTeacher(null);
            setAssignSubjects([]);
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
            const teacherId = await ensureTeacherInFaculty(fullName);

            await setDoc(
                doc(db, "subjects", teacherSubject, "teachers", teacherId),
                { name: fullName }
            );

            setStatus(`Teacher '${fullName}' registered and linked to ${teacherSubject}.`);
            setTeacherName("");
            await loadSubjects();
            await loadAllTeachers();
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
            setStatus(`Created routine ${id}`);
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
            setStatus(`Name set for ${id}`);
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
    // Excel import (subjects)
    // -----------------------
    const downloadSubjectTemplate = async () => {
        try {
            const ExcelJS = await import("exceljs");
            const wb = new ExcelJS.Workbook();
            const ws = wb.addWorksheet("Subjects");

            ws.columns = [
                { header: "Subject Code", key: "code", width: 15 },
                { header: "Subject Name", key: "name", width: 30 },
                { header: "Teacher Name", key: "teacher", width: 30 }
            ];

            ws.addRow({ code: "CS101", name: "Intro to Programming", teacher: "Prof. John Doe" });
            ws.addRow({ code: "CS102", name: "Data Structures", teacher: "Asst. Prof. Jane Smith" });
            ws.addRow({ code: "MATH101", name: "Calculus", teacher: "" });

            ws.getRow(1).font = { bold: true };
            ws.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD3D3D3' }
            };

            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "subjects_template.xlsx";
            a.click();
            window.URL.revokeObjectURL(url);

            setStatus("Template downloaded.");
        } catch (err) {
            setStatus("Error creating template: " + simpleErr(err));
        }
    };

    const handleExcelFileChange = (evt) => {
        const f = evt.target.files?.[0];
        if (!f) { setExcelFile(null); setExcelPreviewCount(null); return; }
        setExcelFile(f);
        setExcelPreviewCount(null);
        setStatus("");
    };

    const handleExcelPreview = async () => {
        if (!excelFile) return setStatus("Select an Excel file first.");
        setStatus("Reading Excel...");
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
            setStatus(`${Math.max(0, rows - 1)} data rows found.`);
        } catch (err) {
            setStatus("Error reading Excel: " + simpleErr(err));
        }
    };

    const handleExcelImport = async () => {
        if (!excelFile) return setStatus("Select an Excel file first.");
        if (!isSignedIn()) return setStatus("You must be signed in to import data.");

        setSaving(true);
        setStatus("Importing subjects...");
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

            const codeIdx = header.findIndex(h => h === "subject code" || h === "code") + 1;
            const nameIdx = header.findIndex(h => h === "subject name" || (h.includes("name") && !h.includes("code"))) + 1;
            const teacherIdx = header.findIndex(h => h === "teacher name" || h === "teacher") + 1;

            if (!codeIdx || !nameIdx) throw new Error("Excel must include Subject Code and Subject Name columns");

            const subjectMap = new Map();
            const teacherSetMap = new Map();

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

            let success = 0, failed = 0, teacherSuccess = 0, teacherSkipped = 0, teacherRegistered = 0;

            for (const [code, name] of subjectMap) {
                try {
                    await setDoc(doc(db, "subjects", code), { name }, { merge: true });
                    success++;
                } catch {
                    failed++;
                }
            }

            for (const [code, teacherNames] of teacherSetMap) {
                for (const teacherFullName of teacherNames) {
                    try {
                        const existingTeacher = await findTeacherByName(teacherFullName);
                        let teacherId;

                        if (existingTeacher) {
                            teacherId = existingTeacher.id;
                        } else {
                            teacherId = await ensureTeacherInFaculty(teacherFullName);
                            teacherRegistered++;
                        }

                        const existingSnap = await getDocs(collection(db, "subjects", code, "teachers"));
                        const alreadyLinked = existingSnap.docs.some(d => d.id === teacherId);

                        if (alreadyLinked) {
                            teacherSkipped++;
                            continue;
                        }

                        await setDoc(
                            doc(db, "subjects", code, "teachers", teacherId),
                            { name: teacherFullName }
                        );
                        teacherSuccess++;
                    } catch {
                        failed++;
                    }
                }
            }

            await loadSubjects();
            await loadAllTeachers();
            setStatus(`Import complete:\n${success} subjects\n${teacherSuccess} teachers linked\n${teacherRegistered} new teachers registered\n${teacherSkipped} skipped (duplicates)`);
            setExcelFile(null);
            setExcelPreviewCount(null);
        } catch (err) {
            setStatus("Excel import error: " + simpleErr(err));
        } finally {
            setSaving(false);
        }
    };

    // -----------------------
    // Excel import (teachers with subjects)
    // -----------------------
    const handleTeacherExcelFileChange = (evt) => {
        const f = evt.target.files?.[0];
        if (!f) {
            setTeacherExcelFile(null);
            setTeacherExcelPreviewCount(null);
            setTeacherExcelPreviewData(null);
            return;
        }
        setTeacherExcelFile(f);
        setTeacherExcelPreviewCount(null);
        setTeacherExcelPreviewData(null);
        setStatus("");
    };

    const handleTeacherExcelPreview = async () => {
        if (!teacherExcelFile) return setStatus("Select a teacher Excel file first.");
        setStatus("Reading teacher Excel...");
        try {
            const ExcelJS = await import("exceljs");
            const wb = new ExcelJS.Workbook();
            const buffer = await teacherExcelFile.arrayBuffer();
            await wb.xlsx.load(buffer);
            const ws = wb.worksheets[0];
            if (!ws) return setStatus("No worksheet found.");

            const header = [];
            ws.getRow(1).eachCell((cell, colNumber) => {
                header[colNumber - 1] = String(cell.value || "").toLowerCase().trim();
            });

            const teacherNameIdx = header.findIndex(h =>
                h === "teacher name" || h === "teacher" || h === "name"
            ) + 1;
            const designationIdx = header.findIndex(h =>
                h === "designation" || h === "title"
            ) + 1;
            const subjectCodeIdx = header.findIndex(h =>
                h === "subject code" || h === "subject" || h === "code"
            ) + 1;

            if (!teacherNameIdx || !subjectCodeIdx) {
                return setStatus("Excel must include 'Teacher Name' and 'Subject Code' columns");
            }

            const teacherSubjectsMap = new Map();
            let rowCount = 0;

            ws.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;

                const teacherName = String(row.getCell(teacherNameIdx).value || "").trim();
                const designation = designationIdx ? String(row.getCell(designationIdx).value || "").trim() : "Prof.";
                const subjectCode = String(row.getCell(subjectCodeIdx).value || "").trim();

                if (!teacherName || !subjectCode) return;

                const fullName = designation ? `${designation} ${teacherName}` : teacherName;
                if (!teacherSubjectsMap.has(fullName)) teacherSubjectsMap.set(fullName, new Set());
                teacherSubjectsMap.get(fullName).add(subjectCode);
                rowCount++;
            });

            setTeacherExcelPreviewCount(rowCount);

            const summary = Array.from(teacherSubjectsMap.entries()).map(([teacher, subjects]) => ({
                teacher,
                subjectCount: subjects.size,
                subjects: Array.from(subjects).join(', ')
            }));

            setTeacherExcelPreviewData(summary);
            setStatus(`Preview: ${rowCount} assignments for ${teacherSubjectsMap.size} teacher(s)`);
        } catch (err) {
            setStatus("Error reading teacher Excel: " + simpleErr(err));
        }
    };

    const handleTeacherExcelImport = async () => {
        if (!teacherExcelFile) return setStatus("Select a teacher Excel file first.");
        if (!isSignedIn()) return setStatus("You must be signed in to import teachers.");

        setSaving(true);
        setStatus("Importing teachers...");
        try {
            const ExcelJS = await import("exceljs");
            const wb = new ExcelJS.Workbook();
            const buffer = await teacherExcelFile.arrayBuffer();
            await wb.xlsx.load(buffer);
            const ws = wb.worksheets[0];
            if (!ws) throw new Error("No worksheet found");

            const header = [];
            ws.getRow(1).eachCell((cell, colNumber) => {
                header[colNumber - 1] = String(cell.value || "").toLowerCase().trim();
            });

            const teacherNameIdx = header.findIndex(h =>
                h === "teacher name" || h === "teacher" || h === "name"
            ) + 1;
            const designationIdx = header.findIndex(h =>
                h === "designation" || h === "title"
            ) + 1;
            const subjectCodeIdx = header.findIndex(h =>
                h === "subject code" || h === "subject" || h === "code"
            ) + 1;

            if (!teacherNameIdx || !subjectCodeIdx) {
                throw new Error("Excel must include 'Teacher Name' and 'Subject Code' columns");
            }

            const teacherSubjectsMap = new Map();

            ws.eachRow((row, rowNumber) => {
                if (rowNumber === 1) return;

                const teacherName = String(row.getCell(teacherNameIdx).value || "").trim();
                const designation = designationIdx ? String(row.getCell(designationIdx).value || "").trim() : "Prof.";
                const subjectCode = String(row.getCell(subjectCodeIdx).value || "").trim();

                if (!teacherName || !subjectCode) return;

                const fullName = designation ? `${designation} ${teacherName}` : teacherName;
                if (!teacherSubjectsMap.has(fullName)) teacherSubjectsMap.set(fullName, new Set());
                teacherSubjectsMap.get(fullName).add(subjectCode);
            });

            let teachersRegistered = 0, assignmentsAdded = 0, assignmentsSkipped = 0, subjectsNotFound = 0;

            for (const [fullName, subjectCodes] of teacherSubjectsMap) {
                const existingTeacher = await findTeacherByName(fullName);
                let teacherId;

                if (existingTeacher) {
                    teacherId = existingTeacher.id;
                } else {
                    teacherId = await ensureTeacherInFaculty(fullName);
                    teachersRegistered++;
                }

                for (const subjectCode of subjectCodes) {
                    try {
                        const subjectDoc = await getDoc(doc(db, "subjects", subjectCode));
                        if (!subjectDoc.exists()) {
                            subjectsNotFound++;
                            continue;
                        }

                        const existingSnap = await getDocs(collection(db, "subjects", subjectCode, "teachers"));
                        const alreadyAssigned = existingSnap.docs.some(d => d.id === teacherId);

                        if (alreadyAssigned) {
                            assignmentsSkipped++;
                            continue;
                        }

                        await setDoc(
                            doc(db, "subjects", subjectCode, "teachers", teacherId),
                            { name: fullName }
                        );
                        assignmentsAdded++;
                    } catch (err) {
                        setStatus("Error during import: " + simpleErr(err));
                    }
                }
            }

            await loadAllTeachers();
            let msg = `Import complete:\n`;
            msg += `${teachersRegistered} new teacher(s) registered\n`;
            msg += `${assignmentsAdded} assignment(s) added\n`;
            msg += `${assignmentsSkipped} assignment(s) skipped (duplicates)`;
            if (subjectsNotFound > 0) msg += `\n${subjectsNotFound} subject(s) not found`;

            setStatus(msg);
            setTeacherExcelFile(null);
            setTeacherExcelPreviewCount(null);
            setTeacherExcelPreviewData(null);
        } catch (err) {
            setStatus("Teacher Excel import error: " + simpleErr(err));
        } finally {
            setSaving(false);
        }
    };

    const downloadTeacherTemplate = async () => {
        try {
            const ExcelJS = await import("exceljs");
            const wb = new ExcelJS.Workbook();
            const ws = wb.addWorksheet("Teachers");

            ws.columns = [
                { header: "Teacher Name", key: "teacherName", width: 30 },
                { header: "Designation", key: "designation", width: 20 },
                { header: "Subject Code", key: "subjectCode", width: 15 }
            ];

            ws.addRow({ teacherName: "John Doe", designation: "Prof.", subjectCode: "CS101" });
            ws.addRow({ teacherName: "John Doe", designation: "Prof.", subjectCode: "CS102" });
            ws.addRow({ teacherName: "John Doe", designation: "Prof.", subjectCode: "CS201" });
            ws.addRow({ teacherName: "Jane Smith", designation: "Asst. Prof.", subjectCode: "MATH101" });
            ws.addRow({ teacherName: "Jane Smith", designation: "Asst. Prof.", subjectCode: "MATH102" });

            ws.getRow(1).font = { bold: true };
            ws.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD3D3D3' }
            };

            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "teacher_subjects_template.xlsx";
            a.click();
            window.URL.revokeObjectURL(url);

            setStatus("Template downloaded.");
        } catch (err) {
            setStatus("Error creating template: " + simpleErr(err));
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
                        <input
                            value={subjectCode}
                            onChange={e => setSubjectCode(e.target.value)}
                            placeholder="e.g. CS101"
                        />
                        <label>Subject Name</label>
                        <input
                            value={subjectName}
                            onChange={e => setSubjectName(e.target.value)}
                            placeholder="e.g. Intro to Programming"
                        />
                        <button type="submit" disabled={saving}>Save Subject</button>
                    </form>

                    <hr />

                    <div className="import-section">
                        <label>Import Subjects from Excel</label>
                        <button
                            onClick={downloadSubjectTemplate}
                            className="template-btn"
                            disabled={saving}
                        >
                            Download Template
                        </button>
                        <input type="file" accept=".xlsx" onChange={handleExcelFileChange} />
                        <div className="import-actions">
                            <button onClick={handleExcelPreview} disabled={!excelFile || saving}>Preview</button>
                            <button onClick={handleExcelImport} disabled={!excelFile || saving}>Import</button>
                        </div>
                        {excelPreviewCount !== null && (
                            <div className="hint">Preview rows: {excelPreviewCount}</div>
                        )}
                        <div className="note">
                            Expected columns: Subject Code, Subject Name, Teacher Name (optional)
                        </div>
                    </div>
                </section>

                {/* Column 2: Teachers */}
                <section className="card column">
                    <h3>Teacher — Add</h3>
                    <form onSubmit={handleTeacherSave} className="form-stack">
                        <label>Select Subject</label>
                        <select
                            value={teacherSubject}
                            onChange={e => setTeacherSubject(e.target.value)}
                            disabled={loadingSubjects}
                        >
                            <option value="">-- choose subject --</option>
                            {allSubjects.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.id}{s.name ? ` — ${s.name}` : ""}
                                </option>
                            ))}
                        </select>

                        <label>Designation</label>
                        <select
                            value={teacherDesignation}
                            onChange={e => setTeacherDesignation(e.target.value)}
                        >
                            <option value="Prof.">Professor </option>
                            <option value="Assoc. Prof.">Associate Professor </option>
                            <option value="Asst. Prof.">Assistant Professor </option>
                        </select>

                        <label>Teacher Name</label>
                        <input
                            value={teacherName}
                            onChange={e => setTeacherName(e.target.value)}
                            placeholder="e.g. Ada Lovelace"
                        />

                        <button type="submit" disabled={saving}>Add Teacher</button>
                    </form>

                    <hr />

                    <div className="import-section">
                        <label>Import Teachers and Subjects from Excel</label>
                        <button
                            onClick={downloadTeacherTemplate}
                            className="template-btn"
                            disabled={saving}
                        >
                            Download Template
                        </button>
                        <input
                            type="file"
                            accept=".xlsx"
                            onChange={handleTeacherExcelFileChange}
                        />
                        <div className="import-actions">
                            <button onClick={handleTeacherExcelPreview} disabled={!teacherExcelFile || saving}>Preview</button>
                            <button onClick={handleTeacherExcelImport} disabled={!teacherExcelFile || saving}>Import</button>
                        </div>

                        {teacherExcelPreviewCount !== null && (
                            <div className="preview-info">
                                <div className="hint">Total rows: {teacherExcelPreviewCount}</div>
                                {teacherExcelPreviewData && (
                                    <div className="preview-details">
                                        <strong>Teachers to import:</strong>
                                        <ul style={{ maxHeight: '150px', overflow: 'auto', fontSize: '0.9em' }}>
                                            {teacherExcelPreviewData.map((item, idx) => (
                                                <li key={idx}>
                                                    <strong>{item.teacher}</strong> — {item.subjectCount} subject(s)
                                                    <br /><small style={{ color: '#666' }}>{item.subjects}</small>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="note">
                            Format: Teacher Name | Designation | Subject Code<br />
                            Same teacher in multiple rows = multiple subjects<br />
                            Designation and name saved together (e.g. "Prof. John Doe")<br />
                            Auto-registered in Faculty_Routine with correct load limit<br />
                            Duplicate assignments are skipped
                        </div>
                    </div>
                </section>

                {/* Column 3: Routines */}
                <section className="card column">
                    <h3>Routine — Create / Name</h3>
                    <form onSubmit={handleRoutineCreate} className="form-stack">
                        <label>New Routine ID</label>
                        <input
                            value={routineId}
                            onChange={e => setRoutineId(e.target.value)}
                            placeholder="e.g. IT1"
                        />
                        <button type="submit" disabled={saving}>Add Routine ID</button>
                    </form>

                    <hr />

                    <form onSubmit={handleRoutineSetName} className="form-stack">
                        <label>Choose Routine</label>
                        <select
                            value={selectedRoutineId}
                            onChange={e => setSelectedRoutineId(e.target.value)}
                            disabled={loadingRoutines}
                        >
                            <option value="">-- choose existing routine --</option>
                            {routineList.map(r => (
                                <option key={r.id} value={r.id}>
                                    {r.id}{r.name ? ` — ${r.name}` : ""}
                                </option>
                            ))}
                        </select>

                        <label>Or type an ID</label>
                        <input
                            value={routineId}
                            onChange={e => setRoutineId(e.target.value)}
                            placeholder="or type routine id"
                        />

                        <label>Routine Name</label>
                        <input
                            value={routineName}
                            onChange={e => setRoutineName(e.target.value)}
                            placeholder="e.g. First Semester"
                        />

                        <button type="submit" disabled={saving}>Set Routine Name</button>
                    </form>
                </section>

                {/* Column 4: Assign Teacher to Multiple Subjects */}
                <section className="card column">
                    <h3>Assign Teacher to Multiple Subjects</h3>
                    <form onSubmit={handleAssignTeacherToMultipleSubjects} className="form-stack">
                        <label>Select Teacher</label>
                        <Select
                            options={allTeachers.map(t => ({ value: t.id, label: t.name }))}
                            value={assignTeacher}
                            onChange={setAssignTeacher}
                            isLoading={loadingTeachers}
                            placeholder="Select teacher..."
                            isClearable
                        />

                        <label>Select Subjects</label>
                        <Select
                            isMulti
                            options={allSubjects.map(s => ({
                                value: s.id,
                                label: `${s.id}${s.name ? ` — ${s.name}` : ""}`
                            }))}
                            value={assignSubjects}
                            onChange={setAssignSubjects}
                            isLoading={loadingSubjects}
                            placeholder="Select one or more subjects..."
                            className="multi-select"
                        />

                        <button
                            type="submit"
                            disabled={saving || !assignTeacher || assignSubjects.length === 0}
                        >
                            Assign to {assignSubjects.length || 0} Subject(s)
                        </button>
                    </form>
                    <div className="note">
                        Assign one teacher to multiple subjects at once.<br />
                        Uses Faculty_Routine ID for consistency.<br />
                        No duplicate assignments created.
                    </div>
                </section>
            </div>

            <div className="status-bar" style={{ whiteSpace: 'pre-line' }}>{status}</div>
        </div>
    );
}