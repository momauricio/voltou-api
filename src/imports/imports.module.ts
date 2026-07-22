import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { CsvImportParser } from './csv-import.parser';
import { NfeXmlImportParser } from './nfe-import.parser';
import { XlsxImportParser } from './xlsx-import.parser';
import { AiImportParser } from './ai-import.parser';
import { ImportAiClient } from './ai-import.client';
import { AiSheetAssistant } from './ai-sheet-assistant';

@Module({
  controllers: [ImportsController],
  providers: [
    ImportsService,
    CsvImportParser,
    NfeXmlImportParser,
    XlsxImportParser,
    AiImportParser,
    ImportAiClient,
    AiSheetAssistant,
  ],
  exports: [ImportsService],
})
export class ImportsModule {}
