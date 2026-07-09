import { Packer, Document, Table, TableRow, TableCell, Paragraph, WidthType, BorderStyle, AlignmentType, VerticalAlign } from 'docx';
import { saveAs } from 'file-saver';
import { DAYS, TIME_SLOTS } from './routineUtils';

/**
 * Assembles schedule parameters into a formatted multi-column data table 
 * and generates an automated local download trigger for a .docx word document.
 * Serves as an isolated presentation export module decoupled from React UI cycles.
 * @param {Object} selectedRoutine - The active routine metadata reference object.
 * @param {Function} getPeriodData - The evaluation callback function used to map daily slots.
 */
export function exportRoutineToDocx(selectedRoutine, getPeriodData) {
  // Guard clause ensuring operation terminates if there is no target file context
  if (!selectedRoutine) {
    alert('Please select a routine first.');
    return;
  }

  // Instantiates a new docx layout tree structural layout definition
  const docFile = new Document({
    sections: [{
      children: [
        // Title element containing the current active class routine identity string
        new Paragraph({
          text: selectedRoutine.name || selectedRoutine.id || 'Weekly Schedule',
          heading: 'Heading1',
          alignment: AlignmentType.CENTER,
        }),
        // Structural spacer node providing paragraph spacing before the main data grid
        new Paragraph({}),
        // Instantiates the primary data table layout structure with global styling configurations
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1 },
            bottom: { style: BorderStyle.SINGLE, size: 1 },
            left: { style: BorderStyle.SINGLE, size: 1 },
            right: { style: BorderStyle.SINGLE, size: 1 },
          },
          rows: [
            // Structural Header Row containing tracking headers and chronological time ranges
            new TableRow({
              children: [
                new TableCell({ children: [new Paragraph('Day / Time')] }),
                ...TIME_SLOTS.map(slot => new TableCell({ children: [new Paragraph(slot.time)] })),
              ],
            }),
            // Iterates across calendar days to programmatically inject timeline assignments
            ...DAYS.map((day) =>
              new TableRow({
                children: [
                  // Leading row marker identifying the current calendar day column cell
                  new TableCell({ children: [new Paragraph(day)] }),
                  // Inner loop building out sequential cells for each available timeframe node
                  ...TIME_SLOTS.map((slot) => {
                    // Handles the rendering branch dedicated exclusively to empty lunch intervals
                    if (slot.isLunch) {
                      return new TableCell({ 
                        children: [new Paragraph('Lunch Break')], 
                        verticalAlign: VerticalAlign.CENTER 
                      });
                    }
                    
                    // Resolves individual cell data tracking maps via the provided interface callback
                    const pd = getPeriodData(day, slot.period);
                    let cellText = '-'; // Fallback visual placeholder text for vacant intervals
                    
                    // Conditionally appends line-separated properties if metadata mapping matches exist
                    if (pd?.subject) {
                      cellText = pd.subject;
                      if (pd.code) cellText += `\n[${pd.code}]`;
                      if (pd.teacher) cellText += `\n${pd.teacher}`;
                      if (pd.room) cellText += `\nRoom: ${pd.room}`;
                    }
                    
                    // Outputs the populated data table container frame cell properties
                    return new TableCell({ 
                      children: [new Paragraph(cellText)], 
                      verticalAlign: VerticalAlign.CENTER 
                    });
                  }),
                ],
              })
            ),
          ],
        }),
      ],
    }],
  });

  // Packages the finalized structural data layouts tree into binary blob outputs for disk writes
  Packer.toBlob(docFile)
    .then(blob => saveAs(blob, `${selectedRoutine.name || selectedRoutine.id}_routine.docx`))
    .catch(err => {
      console.error(err);
      alert('Failed to generate DOCX.');
    });
}