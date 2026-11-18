// GERADO por services/api/scripts/generate_ifc_schema_data.py a partir do esquema
// IFC4X3_ADD2 e dos modelos de conjuntos de propriedades do IfcOpenShell
// 0.9.0.post1. Não editar à mão.

export const IFC_SCHEMA_ID = 'IFC4X3_ADD2';

export interface IfcEntityDefinition {
  /** Supertipos, do mais próximo ao mais geral. */
  readonly ancestors: readonly string[];
  readonly predefinedTypes: readonly string[];
  /** Entidade de tipo correspondente (`Ifc…Type`), nas ocorrências. */
  readonly typeEntity?: string;
}

export interface IfcPropertyTemplate {
  /** `P_SINGLEVALUE`, `P_ENUMERATEDVALUE`, `P_BOUNDEDVALUE`, `Q_LENGTH`… */
  readonly kind: string;
  /** Tipo de valor IFC (`IfcLabel`…); `null` nas quantidades. */
  readonly type: string | null;
  readonly enumeration?: {
    readonly name: string;
    readonly values: readonly string[];
  };
}

export interface IfcPropertySetTemplate {
  /** `Entidade` ou `Entidade/TIPOPREDEFINIDO`. */
  readonly applicable: readonly string[];
  readonly templateType: string;
  readonly properties: Readonly<Record<string, IfcPropertyTemplate>>;
}

export const IFC_ENTITIES: Readonly<Record<string, IfcEntityDefinition>> = {
  IfcPipeSegment: {
    ancestors: [
      'IfcFlowSegment',
      'IfcDistributionFlowElement',
      'IfcDistributionElement',
      'IfcElement',
      'IfcProduct',
      'IfcObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'CULVERT',
      'FLEXIBLESEGMENT',
      'GUTTER',
      'RIGIDSEGMENT',
      'SPOOL',
      'USERDEFINED',
      'NOTDEFINED',
    ],
    typeEntity: 'IfcPipeSegmentType',
  },
  IfcPipeSegmentType: {
    ancestors: [
      'IfcFlowSegmentType',
      'IfcDistributionFlowElementType',
      'IfcDistributionElementType',
      'IfcElementType',
      'IfcTypeProduct',
      'IfcTypeObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'CULVERT',
      'FLEXIBLESEGMENT',
      'GUTTER',
      'RIGIDSEGMENT',
      'SPOOL',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcPipeFitting: {
    ancestors: [
      'IfcFlowFitting',
      'IfcDistributionFlowElement',
      'IfcDistributionElement',
      'IfcElement',
      'IfcProduct',
      'IfcObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'BEND',
      'CONNECTOR',
      'ENTRY',
      'EXIT',
      'JUNCTION',
      'OBSTRUCTION',
      'TRANSITION',
      'USERDEFINED',
      'NOTDEFINED',
    ],
    typeEntity: 'IfcPipeFittingType',
  },
  IfcPipeFittingType: {
    ancestors: [
      'IfcFlowFittingType',
      'IfcDistributionFlowElementType',
      'IfcDistributionElementType',
      'IfcElementType',
      'IfcTypeProduct',
      'IfcTypeObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'BEND',
      'CONNECTOR',
      'ENTRY',
      'EXIT',
      'JUNCTION',
      'OBSTRUCTION',
      'TRANSITION',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcValve: {
    ancestors: [
      'IfcFlowController',
      'IfcDistributionFlowElement',
      'IfcDistributionElement',
      'IfcElement',
      'IfcProduct',
      'IfcObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'AIRRELEASE',
      'ANTIVACUUM',
      'CHANGEOVER',
      'CHECK',
      'COMMISSIONING',
      'DIVERTING',
      'DOUBLECHECK',
      'DOUBLEREGULATING',
      'DRAWOFFCOCK',
      'FAUCET',
      'FLUSHING',
      'GASCOCK',
      'GASTAP',
      'ISOLATING',
      'MIXING',
      'PRESSUREREDUCING',
      'PRESSURERELIEF',
      'REGULATING',
      'SAFETYCUTOFF',
      'STEAMTRAP',
      'STOPCOCK',
      'USERDEFINED',
      'NOTDEFINED',
    ],
    typeEntity: 'IfcValveType',
  },
  IfcValveType: {
    ancestors: [
      'IfcFlowControllerType',
      'IfcDistributionFlowElementType',
      'IfcDistributionElementType',
      'IfcElementType',
      'IfcTypeProduct',
      'IfcTypeObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'AIRRELEASE',
      'ANTIVACUUM',
      'CHANGEOVER',
      'CHECK',
      'COMMISSIONING',
      'DIVERTING',
      'DOUBLECHECK',
      'DOUBLEREGULATING',
      'DRAWOFFCOCK',
      'FAUCET',
      'FLUSHING',
      'GASCOCK',
      'GASTAP',
      'ISOLATING',
      'MIXING',
      'PRESSUREREDUCING',
      'PRESSURERELIEF',
      'REGULATING',
      'SAFETYCUTOFF',
      'STEAMTRAP',
      'STOPCOCK',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcPump: {
    ancestors: [
      'IfcFlowMovingDevice',
      'IfcDistributionFlowElement',
      'IfcDistributionElement',
      'IfcElement',
      'IfcProduct',
      'IfcObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'CIRCULATOR',
      'ENDSUCTION',
      'SPLITCASE',
      'SUBMERSIBLEPUMP',
      'SUMPPUMP',
      'VERTICALINLINE',
      'VERTICALTURBINE',
      'USERDEFINED',
      'NOTDEFINED',
    ],
    typeEntity: 'IfcPumpType',
  },
  IfcPumpType: {
    ancestors: [
      'IfcFlowMovingDeviceType',
      'IfcDistributionFlowElementType',
      'IfcDistributionElementType',
      'IfcElementType',
      'IfcTypeProduct',
      'IfcTypeObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'CIRCULATOR',
      'ENDSUCTION',
      'SPLITCASE',
      'SUBMERSIBLEPUMP',
      'SUMPPUMP',
      'VERTICALINLINE',
      'VERTICALTURBINE',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcTank: {
    ancestors: [
      'IfcFlowStorageDevice',
      'IfcDistributionFlowElement',
      'IfcDistributionElement',
      'IfcElement',
      'IfcProduct',
      'IfcObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'BASIN',
      'BREAKPRESSURE',
      'EXPANSION',
      'FEEDANDEXPANSION',
      'OILRETENTIONTRAY',
      'PRESSUREVESSEL',
      'STORAGE',
      'VESSEL',
      'USERDEFINED',
      'NOTDEFINED',
    ],
    typeEntity: 'IfcTankType',
  },
  IfcTankType: {
    ancestors: [
      'IfcFlowStorageDeviceType',
      'IfcDistributionFlowElementType',
      'IfcDistributionElementType',
      'IfcElementType',
      'IfcTypeProduct',
      'IfcTypeObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'BASIN',
      'BREAKPRESSURE',
      'EXPANSION',
      'FEEDANDEXPANSION',
      'OILRETENTIONTRAY',
      'PRESSUREVESSEL',
      'STORAGE',
      'VESSEL',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcFilter: {
    ancestors: [
      'IfcFlowTreatmentDevice',
      'IfcDistributionFlowElement',
      'IfcDistributionElement',
      'IfcElement',
      'IfcProduct',
      'IfcObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'AIRPARTICLEFILTER',
      'COMPRESSEDAIRFILTER',
      'ODORFILTER',
      'OILFILTER',
      'STRAINER',
      'WATERFILTER',
      'USERDEFINED',
      'NOTDEFINED',
    ],
    typeEntity: 'IfcFilterType',
  },
  IfcFilterType: {
    ancestors: [
      'IfcFlowTreatmentDeviceType',
      'IfcDistributionFlowElementType',
      'IfcDistributionElementType',
      'IfcElementType',
      'IfcTypeProduct',
      'IfcTypeObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'AIRPARTICLEFILTER',
      'COMPRESSEDAIRFILTER',
      'ODORFILTER',
      'OILFILTER',
      'STRAINER',
      'WATERFILTER',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcFlowMeter: {
    ancestors: [
      'IfcFlowController',
      'IfcDistributionFlowElement',
      'IfcDistributionElement',
      'IfcElement',
      'IfcProduct',
      'IfcObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'ENERGYMETER',
      'GASMETER',
      'OILMETER',
      'WATERMETER',
      'USERDEFINED',
      'NOTDEFINED',
    ],
    typeEntity: 'IfcFlowMeterType',
  },
  IfcFlowMeterType: {
    ancestors: [
      'IfcFlowControllerType',
      'IfcDistributionFlowElementType',
      'IfcDistributionElementType',
      'IfcElementType',
      'IfcTypeProduct',
      'IfcTypeObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'ENERGYMETER',
      'GASMETER',
      'OILMETER',
      'WATERMETER',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcSensor: {
    ancestors: [
      'IfcDistributionControlElement',
      'IfcDistributionElement',
      'IfcElement',
      'IfcProduct',
      'IfcObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'CO2SENSOR',
      'CONDUCTANCESENSOR',
      'CONTACTSENSOR',
      'COSENSOR',
      'EARTHQUAKESENSOR',
      'FIRESENSOR',
      'FLOWSENSOR',
      'FOREIGNOBJECTDETECTIONSENSOR',
      'FROSTSENSOR',
      'GASSENSOR',
      'HEATSENSOR',
      'HUMIDITYSENSOR',
      'IDENTIFIERSENSOR',
      'IONCONCENTRATIONSENSOR',
      'LEVELSENSOR',
      'LIGHTSENSOR',
      'MOISTURESENSOR',
      'MOVEMENTSENSOR',
      'OBSTACLESENSOR',
      'PHSENSOR',
      'PRESSURESENSOR',
      'RADIATIONSENSOR',
      'RADIOACTIVITYSENSOR',
      'RAINSENSOR',
      'SMOKESENSOR',
      'SNOWDEPTHSENSOR',
      'SOUNDSENSOR',
      'TEMPERATURESENSOR',
      'TRAINSENSOR',
      'TURNOUTCLOSURESENSOR',
      'WHEELSENSOR',
      'WINDSENSOR',
      'USERDEFINED',
      'NOTDEFINED',
    ],
    typeEntity: 'IfcSensorType',
  },
  IfcSensorType: {
    ancestors: [
      'IfcDistributionControlElementType',
      'IfcDistributionElementType',
      'IfcElementType',
      'IfcTypeProduct',
      'IfcTypeObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'CO2SENSOR',
      'CONDUCTANCESENSOR',
      'CONTACTSENSOR',
      'COSENSOR',
      'EARTHQUAKESENSOR',
      'FIRESENSOR',
      'FLOWSENSOR',
      'FOREIGNOBJECTDETECTIONSENSOR',
      'FROSTSENSOR',
      'GASSENSOR',
      'HEATSENSOR',
      'HUMIDITYSENSOR',
      'IDENTIFIERSENSOR',
      'IONCONCENTRATIONSENSOR',
      'LEVELSENSOR',
      'LIGHTSENSOR',
      'MOISTURESENSOR',
      'MOVEMENTSENSOR',
      'OBSTACLESENSOR',
      'PHSENSOR',
      'PRESSURESENSOR',
      'RADIATIONSENSOR',
      'RADIOACTIVITYSENSOR',
      'RAINSENSOR',
      'SMOKESENSOR',
      'SNOWDEPTHSENSOR',
      'SOUNDSENSOR',
      'TEMPERATURESENSOR',
      'TRAINSENSOR',
      'TURNOUTCLOSURESENSOR',
      'WHEELSENSOR',
      'WINDSENSOR',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcActuator: {
    ancestors: [
      'IfcDistributionControlElement',
      'IfcDistributionElement',
      'IfcElement',
      'IfcProduct',
      'IfcObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'ELECTRICACTUATOR',
      'HANDOPERATEDACTUATOR',
      'HYDRAULICACTUATOR',
      'PNEUMATICACTUATOR',
      'THERMOSTATICACTUATOR',
      'USERDEFINED',
      'NOTDEFINED',
    ],
    typeEntity: 'IfcActuatorType',
  },
  IfcActuatorType: {
    ancestors: [
      'IfcDistributionControlElementType',
      'IfcDistributionElementType',
      'IfcElementType',
      'IfcTypeProduct',
      'IfcTypeObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'ELECTRICACTUATOR',
      'HANDOPERATEDACTUATOR',
      'HYDRAULICACTUATOR',
      'PNEUMATICACTUATOR',
      'THERMOSTATICACTUATOR',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcDiscreteAccessory: {
    ancestors: [
      'IfcElementComponent',
      'IfcElement',
      'IfcProduct',
      'IfcObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'ANCHORPLATE',
      'BIRDPROTECTION',
      'BRACKET',
      'CABLEARRANGER',
      'ELASTIC_CUSHION',
      'EXPANSION_JOINT_DEVICE',
      'FILLER',
      'FLASHING',
      'INSULATOR',
      'LOCK',
      'PANEL_STRENGTHENING',
      'POINTMACHINEMOUNTINGDEVICE',
      'POINT_MACHINE_LOCKING_DEVICE',
      'RAILBRACE',
      'RAILPAD',
      'RAIL_LUBRICATION',
      'RAIL_MECHANICAL_EQUIPMENT',
      'SHOE',
      'SLIDINGCHAIR',
      'SOUNDABSORPTION',
      'TENSIONINGEQUIPMENT',
      'USERDEFINED',
      'NOTDEFINED',
    ],
    typeEntity: 'IfcDiscreteAccessoryType',
  },
  IfcDiscreteAccessoryType: {
    ancestors: [
      'IfcElementComponentType',
      'IfcElementType',
      'IfcTypeProduct',
      'IfcTypeObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'ANCHORPLATE',
      'BIRDPROTECTION',
      'BRACKET',
      'CABLEARRANGER',
      'ELASTIC_CUSHION',
      'EXPANSION_JOINT_DEVICE',
      'FILLER',
      'FLASHING',
      'INSULATOR',
      'LOCK',
      'PANEL_STRENGTHENING',
      'POINTMACHINEMOUNTINGDEVICE',
      'POINT_MACHINE_LOCKING_DEVICE',
      'RAILBRACE',
      'RAILPAD',
      'RAIL_LUBRICATION',
      'RAIL_MECHANICAL_EQUIPMENT',
      'SHOE',
      'SLIDINGCHAIR',
      'SOUNDABSORPTION',
      'TENSIONINGEQUIPMENT',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcDistributionChamberElement: {
    ancestors: [
      'IfcDistributionFlowElement',
      'IfcDistributionElement',
      'IfcElement',
      'IfcProduct',
      'IfcObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'FORMEDDUCT',
      'INSPECTIONCHAMBER',
      'INSPECTIONPIT',
      'MANHOLE',
      'METERCHAMBER',
      'SUMP',
      'TRENCH',
      'VALVECHAMBER',
      'USERDEFINED',
      'NOTDEFINED',
    ],
    typeEntity: 'IfcDistributionChamberElementType',
  },
  IfcDistributionChamberElementType: {
    ancestors: [
      'IfcDistributionFlowElementType',
      'IfcDistributionElementType',
      'IfcElementType',
      'IfcTypeProduct',
      'IfcTypeObject',
      'IfcObjectDefinition',
      'IfcRoot',
    ],
    predefinedTypes: [
      'FORMEDDUCT',
      'INSPECTIONCHAMBER',
      'INSPECTIONPIT',
      'MANHOLE',
      'METERCHAMBER',
      'SUMP',
      'TRENCH',
      'VALVECHAMBER',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcDistributionPort: {
    ancestors: ['IfcPort', 'IfcProduct', 'IfcObject', 'IfcObjectDefinition', 'IfcRoot'],
    predefinedTypes: [
      'CABLE',
      'CABLECARRIER',
      'DUCT',
      'PIPE',
      'WIRELESS',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
  IfcDistributionSystem: {
    ancestors: ['IfcSystem', 'IfcGroup', 'IfcObject', 'IfcObjectDefinition', 'IfcRoot'],
    predefinedTypes: [
      'AIRCONDITIONING',
      'AUDIOVISUAL',
      'CATENARY_SYSTEM',
      'CHEMICAL',
      'CHILLEDWATER',
      'COMMUNICATION',
      'COMPRESSEDAIR',
      'CONDENSERWATER',
      'CONTROL',
      'CONVEYING',
      'DATA',
      'DISPOSAL',
      'DOMESTICCOLDWATER',
      'DOMESTICHOTWATER',
      'DRAINAGE',
      'EARTHING',
      'ELECTRICAL',
      'ELECTROACOUSTIC',
      'EXHAUST',
      'FIREPROTECTION',
      'FIXEDTRANSMISSIONNETWORK',
      'FUEL',
      'GAS',
      'HAZARDOUS',
      'HEATING',
      'LIGHTING',
      'LIGHTNINGPROTECTION',
      'MOBILENETWORK',
      'MONITORINGSYSTEM',
      'MUNICIPALSOLIDWASTE',
      'OIL',
      'OPERATIONAL',
      'OPERATIONALTELEPHONYSYSTEM',
      'OVERHEAD_CONTACTLINE_SYSTEM',
      'POWERGENERATION',
      'RAINWATER',
      'REFRIGERATION',
      'RETURN_CIRCUIT',
      'SECURITY',
      'SEWAGE',
      'SIGNAL',
      'STORMWATER',
      'TELEPHONE',
      'TV',
      'VACUUM',
      'VENT',
      'VENTILATION',
      'WASTEWATER',
      'WATERSUPPLY',
      'USERDEFINED',
      'NOTDEFINED',
    ],
  },
};

export const IFC_PROPERTY_SETS: Readonly<Record<string, IfcPropertySetTemplate>> = {
  Pset_DistributionPortCommon: {
    applicable: ['IfcDistributionPort'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      PortNumber: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcInteger',
      },
      ColourCode: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
    },
  },
  Pset_DistributionPortTypeCable: {
    applicable: ['IfcDistributionPort/CABLE'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      ElectricalConnectionType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_DistributionPortElectricalType',
          values: [
            'ACPLUG',
            'COAXIAL',
            'CRIMP',
            'DCPLUG',
            'DIN',
            'DSUB',
            'DVI',
            'EIAJ',
            'HDMI',
            'RADIO',
            'RCA',
            'RJ',
            'SOCKET',
            'TRS',
            'USB',
            'XLR',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      ConnectionSubtype: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      ConnectionGender: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_DistributionPortGender',
          values: ['FEMALE', 'MALE', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      ConductorFunction: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_ConductorFunctionEnum',
          values: [
            'NEUTRAL',
            'PHASE_L1',
            'PHASE_L2',
            'PHASE_L3',
            'PROTECTIVEEARTH',
            'PROTECTIVEEARTHNEUTRAL',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      CurrentContent3rdHarmonic: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveRatioMeasure',
      },
      Current: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcElectricCurrentMeasure',
      },
      Voltage: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcElectricVoltageMeasure',
      },
      Power: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcPowerMeasure',
      },
      Protocols: {
        kind: 'P_LISTVALUE',
        type: 'IfcIdentifier',
      },
      HasConnector: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
      IsWelded: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
    },
  },
  Pset_DistributionPortTypeDuct: {
    applicable: ['IfcDistributionPort/DUCT'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      ConnectionType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_DuctConnectionType',
          values: [
            'BEADEDSLEEVE',
            'COMPRESSION',
            'CRIMP',
            'DRAWBAND',
            'DRIVESLIP',
            'FLANGED',
            'NONE',
            'OUTSIDESLEEVE',
            'SLIPON',
            'SOLDERED',
            'SSLIP',
            'STANDINGSEAM',
            'SWEDGE',
            'WELDED',
            'OTHER',
            'USERDEFINED',
            'NOTDEFINED',
          ],
        },
      },
      ConnectionSubtype: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      NominalWidth: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcNonNegativeLengthMeasure',
      },
      NominalHeight: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      NominalThickness: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcNonNegativeLengthMeasure',
      },
      DryBulbTemperature: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcThermodynamicTemperatureMeasure',
      },
      WetBulbTemperature: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcThermodynamicTemperatureMeasure',
      },
      VolumetricFlowRate: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcVolumetricFlowRateMeasure',
      },
      Velocity: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcLinearVelocityMeasure',
      },
      Pressure: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcPressureMeasure',
      },
    },
  },
  Pset_DistributionPortTypePipe: {
    applicable: ['IfcDistributionPort/PIPE'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      ConnectionType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_PipeEndStyleTreatment',
          values: [
            'BRAZED',
            'COMPRESSION',
            'FLANGED',
            'GROOVED',
            'NONE',
            'OUTSIDESLEEVE',
            'SOLDERED',
            'SWEDGE',
            'THREADED',
            'WELDED',
            'OTHER',
            'UNSET',
          ],
        },
      },
      ConnectionSubtype: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      NominalDiameter: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      InnerDiameter: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      OuterDiameter: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      Temperature: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcThermodynamicTemperatureMeasure',
      },
      VolumetricFlowRate: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcVolumetricFlowRateMeasure',
      },
      MassFlowRate: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcMassFlowRateMeasure',
      },
      FlowCondition: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcPositiveRatioMeasure',
      },
      Velocity: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcLinearVelocityMeasure',
      },
      Pressure: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcPressureMeasure',
      },
    },
  },
  Pset_DistributionSystemCommon: {
    applicable: ['IfcDistributionSystem'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      Reference: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
    },
  },
  Pset_DistributionSystemTypeElectrical: {
    applicable: ['IfcDistributionSystem/ELECTRICAL'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      ElectricalSystemType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_DistributionSystemElectricalType',
          values: ['IT', 'TN', 'TN_C', 'TN_C_S', 'TN_S', 'TT', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      ElectricalSystemCategory: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_DistributionSystemElectricalCategory',
          values: ['EXTRALOWVOLTAGE', 'HIGHVOLTAGE', 'LOWVOLTAGE', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      Diversity: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveRatioMeasure',
      },
      NumberOfLiveConductors: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcCountMeasure',
      },
      MaximumAllowedVoltageDrop: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcElectricVoltageMeasure',
      },
      NetImpedance: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcElectricResistanceMeasure',
      },
      RatedVoltageRange: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcElectricVoltageMeasure',
      },
    },
  },
  Pset_DistributionSystemTypeOverheadContactlineSystem: {
    applicable: ['IfcDistributionSystem/OVERHEAD_CONTACTLINE_SYSTEM'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      SpanNominalLength: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      ContactWireStagger: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      ContactWireNominalDrop: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      PressureRange: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcPressureMeasure',
      },
      ContactWireNominalHeight: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      ContactWireUplift: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcNonNegativeLengthMeasure',
      },
      ElectricalClearance: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      NumberOfOverlappingSpans: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcCountMeasure',
      },
      PantographType: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      TensionLength: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      OCSType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_OverheadContactLineType',
          values: [
            'COMPOUND_CATENARY_SUSPENSION',
            'OCL_WITH_CATENARY_SUSPENSION',
            'OCL_WITH_STITCHED_CATENARY_SUSPENSION',
            'RIGID_CATENARY',
            'TROLLY_TYPE_CONTACT_LINE',
            'TROLLY_TYPE_WITH_STITCHWIRE',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
    },
  },
  Pset_DistributionSystemTypeVentilation: {
    applicable: ['IfcDistributionSystem/VENTILATION'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      DesignName: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      DuctSizingMethod: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_DuctSizingMethod',
          values: [
            'CONSTANTFRICTION',
            'CONSTANTPRESSURE',
            'STATICREGAIN',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      PressureClass: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      LeakageClass: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      FrictionLoss: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcReal',
      },
      ScrapFactor: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcReal',
      },
      DuctSealant: {
        kind: 'P_REFERENCEVALUE',
        type: 'IfcMaterialDefinition',
      },
      MaximumVelocity: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLinearVelocityMeasure',
      },
      AspectRatio: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcReal',
      },
      MinimumHeight: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      MinimumWidth: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
    },
  },
  Pset_ElementSize: {
    applicable: [
      'IfcDistributionChamberElement',
      'IfcEnergyConversionDevice',
      'IfcFlowController',
      'IfcFlowMovingDevice',
      'IfcFlowStorageDevice',
      'IfcFlowTerminal',
      'IfcFlowTreatmentDevice',
      'IfcDistributionChamberElementType',
      'IfcEnergyConversionDeviceType',
      'IfcFlowControllerType',
      'IfcFlowMovingDeviceType',
      'IfcFlowStorageDeviceType',
      'IfcFlowTerminalType',
      'IfcFlowTreatmentDeviceType',
    ],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      NominalLength: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      NominalWidth: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      NominalHeight: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
    },
  },
  Pset_FilterTypeAirParticleFilter: {
    applicable: ['IfcFilter/AIRPARTICLEFILTER', 'IfcFilterType/AIRPARTICLEFILTER'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      AirParticleFilterType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_FilterAirParticleFilterType',
          values: [
            'ADHESIVERESERVOIR',
            'COARSECELLFOAMS',
            'COARSEMETALSCREEN',
            'COARSESPUNGLASS',
            'ELECTRICALFILTER',
            'HEPAFILTER',
            'MEDIUMELECTRETFILTER',
            'MEDIUMNATURALFIBERFILTER',
            'MEMBRANEFILTERS',
            'RENEWABLEMOVINGCURTIANDRYMEDIAFILTER',
            'ROLLFORM',
            'ULPAFILTER',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      FrameMaterial: {
        kind: 'P_REFERENCEVALUE',
        type: 'IfcMaterialDefinition',
      },
      SeparationType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_FilterAirParticleFilterSeparationType',
          values: ['BAG', 'PLEAT', 'TREADSEPARATION', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      DustHoldingCapacity: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcMassMeasure',
      },
      FaceSurfaceArea: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcAreaMeasure',
      },
      MediaExtendedArea: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcAreaMeasure',
      },
      NominalCountedEfficiency: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcReal',
      },
      NominalWeightedEfficiency: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcReal',
      },
      PressureDropCurve: {
        kind: 'P_TABLEVALUE',
        type: 'IfcVolumetricFlowRateMeasure',
      },
      CountedEfficiencyCurve: {
        kind: 'P_TABLEVALUE',
        type: 'IfcMassMeasure',
      },
      WeightedEfficiencyCurve: {
        kind: 'P_TABLEVALUE',
        type: 'IfcMassMeasure',
      },
    },
  },
  Pset_FilterTypeCommon: {
    applicable: ['IfcFilter', 'IfcFilterType'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      Reference: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
      Status: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_ElementStatus',
          values: ['DEMOLISH', 'EXISTING', 'NEW', 'TEMPORARY', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      Weight: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcMassMeasure',
      },
      InitialResistance: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      FinalResistance: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      OperationTemperatureRange: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcThermodynamicTemperatureMeasure',
      },
      FlowRateRange: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcVolumetricFlowRateMeasure',
      },
      NominalFilterFaceVelocity: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLinearVelocityMeasure',
      },
      NominalMediaSurfaceVelocity: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLinearVelocityMeasure',
      },
      NominalPressureDrop: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      NominalFlowrate: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcVolumetricFlowRateMeasure',
      },
      NominalParticleGeometricMeanDiameter: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      NominalParticleGeometricStandardDeviation: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcReal',
      },
    },
  },
  Pset_FilterTypeCompressedAirFilter: {
    applicable: ['IfcFilter/COMPRESSEDAIRFILTER', 'IfcFilterType/COMPRESSEDAIRFILTER'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      CompressedAirFilterType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_CompressedAirFilterType',
          values: [
            'ACTIVATEDCARBON',
            'COALESCENSE_FILTER',
            'PARTICLE_FILTER',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      OperationPressureMax: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      ParticleAbsorptionCurve: {
        kind: 'P_TABLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      AutomaticCondensateDischarge: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
      CloggingIndicator: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
    },
  },
  Pset_FilterTypeWaterFilter: {
    applicable: ['IfcFilter/WATERFILTER', 'IfcFilterType/WATERFILTER'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      WaterFilterType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_FilterWaterFilterType',
          values: [
            'FILTRATION_DIATOMACEOUSEARTH',
            'FILTRATION_SAND',
            'PURIFICATION_DEIONIZING',
            'PURIFICATION_REVERSEOSMOSIS',
            'SOFTENING_ZEOLITE',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
    },
  },
  Pset_ManufacturerOccurrence: {
    applicable: ['IfcElement'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      AcquisitionDate: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcDate',
      },
      BarCode: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
      SerialNumber: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
      BatchReference: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
      AssemblyPlace: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_AssemblyPlace',
          values: ['FACTORY', 'OFFSITE', 'SITE', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      ManufacturingDate: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcDate',
      },
    },
  },
  Pset_ManufacturerTypeInformation: {
    applicable: ['IfcElement', 'IfcElementType'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      GlobalTradeItemNumber: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
      ArticleNumber: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
      ModelReference: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      ModelLabel: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      Manufacturer: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      ProductionYear: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      AssemblyPlace: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_AssemblyPlace',
          values: ['FACTORY', 'OFFSITE', 'SITE', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      OperationalDocument: {
        kind: 'P_REFERENCEVALUE',
        type: 'IfcExternalReference',
      },
      SafetyDocument: {
        kind: 'P_REFERENCEVALUE',
        type: 'IfcDocumentReference',
      },
      PerformanceCertificate: {
        kind: 'P_REFERENCEVALUE',
        type: 'IfcDocumentReference',
      },
    },
  },
  Pset_PipeConnectionFlanged: {
    applicable: ['IfcPipeSegment', 'IfcPipeSegmentType'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      FlangeTable: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      FlangeStandard: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      BoreSize: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      FlangeDiameter: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      FlangeThickness: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      NumberOfBoltholes: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcCountMeasure',
      },
      BoltSize: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      BoltholePitch: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
    },
  },
  Pset_PipeFittingOccurrence: {
    applicable: ['IfcPipeFitting'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      InteriorRoughnessCoefficient: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      Colour: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
    },
  },
  Pset_PipeFittingTypeCommon: {
    applicable: ['IfcPipeFitting', 'IfcPipeFittingType'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      Reference: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
      Status: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_ElementStatus',
          values: ['DEMOLISH', 'EXISTING', 'NEW', 'TEMPORARY', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      PressureClass: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      PressureRange: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcPressureMeasure',
      },
      TemperatureRange: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcThermodynamicTemperatureMeasure',
      },
      FittingLossFactor: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcReal',
      },
    },
  },
  Pset_PipeSegmentOccurrence: {
    applicable: ['IfcPipeSegment'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      InteriorRoughnessCoefficient: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      Colour: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLabel',
      },
      Gradient: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveRatioMeasure',
      },
      InvertElevation: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLengthMeasure',
      },
    },
  },
  Pset_PipeSegmentTypeCommon: {
    applicable: ['IfcPipeSegment', 'IfcPipeSegmentType'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      Reference: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
      Status: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_ElementStatus',
          values: ['DEMOLISH', 'EXISTING', 'NEW', 'TEMPORARY', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      WorkingPressure: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      PressureRange: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcPressureMeasure',
      },
      TemperatureRange: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcThermodynamicTemperatureMeasure',
      },
      NominalDiameter: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      InnerDiameter: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      OuterDiameter: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      Length: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
    },
  },
  Pset_PipeSegmentTypeCulvert: {
    applicable: ['IfcPipeSegment/CULVERT', 'IfcPipeSegmentType/CULVERT'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      InternalWidth: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      ClearDepth: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
    },
  },
  Pset_PipeSegmentTypeGutter: {
    applicable: ['IfcPipeSegment/GUTTER', 'IfcPipeSegmentType/GUTTER'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      Slope: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPlaneAngleMeasure',
      },
      FlowRating: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcVolumetricFlowRateMeasure',
      },
      Complementaryfunction: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_ComplementaryWorks',
          values: [
            'DISPERSING_WELLS',
            'LIFTING_WATER_WELLS',
            'TRANSVERSAL_WATER_REMOVAL',
            'OTHER',
            'NOTKNOWN',
            'NOTDEFINED',
          ],
        },
      },
      OrthometricHeight: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcLengthMeasure',
      },
      IsCovered: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
      IsMonitored: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
    },
  },
  Pset_PumpOccurrence: {
    applicable: ['IfcPump'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      ImpellerDiameter: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      BaseType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_PumpBaseType',
          values: ['BASE', 'FRAME', 'NONE', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      DriveConnectionType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_PumpDriveConnectionType',
          values: ['BELTDRIVE', 'COUPLING', 'DIRECTDRIVE', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
    },
  },
  Pset_PumpTypeCommon: {
    applicable: ['IfcPump', 'IfcPumpType'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      Reference: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
      Status: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_ElementStatus',
          values: ['DEMOLISH', 'EXISTING', 'NEW', 'TEMPORARY', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      FlowRateRange: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcMassFlowRateMeasure',
      },
      FlowResistanceRange: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcPressureMeasure',
      },
      ConnectionSize: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      TemperatureRange: {
        kind: 'P_BOUNDEDVALUE',
        type: 'IfcThermodynamicTemperatureMeasure',
      },
      NetPositiveSuctionHead: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      NominalRotationSpeed: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcRotationalFrequencyMeasure',
      },
    },
  },
  Pset_TankOccurrence: {
    applicable: ['IfcTank'],
    templateType: 'PSET_OCCURRENCEDRIVEN',
    properties: {
      TankComposition: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_TankComposition',
          values: ['COMPLEX', 'ELEMENT', 'PARTIAL', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      HasLadder: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
      HasVisualIndicator: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
    },
  },
  Pset_TankTypeCommon: {
    applicable: ['IfcTank', 'IfcTankType'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      Reference: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
      Status: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_ElementStatus',
          values: ['DEMOLISH', 'EXISTING', 'NEW', 'TEMPORARY', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      AccessType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_TankAccessType',
          values: [
            'LOOSECOVER',
            'MANHOLE',
            'NONE',
            'SECUREDCOVER',
            'SECUREDCOVERWITHMANHOLE',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      StorageType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_TankStorageType',
          values: [
            'FUEL',
            'ICE',
            'OIL',
            'POTABLEWATER',
            'RAINWATER',
            'WASTEWATER',
            'WATER',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      NominalLengthOrDiameter: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      NominalWidthOrDiameter: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      NominalDepth: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcNonNegativeLengthMeasure',
      },
      TankNominalCapacity: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcVolumeMeasure',
      },
      EffectiveCapacity: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcVolumeMeasure',
      },
      OperatingWeight: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcMassMeasure',
      },
      PatternType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_TankPatternType',
          values: [
            'HORIZONTALCYLINDER',
            'RECTANGULAR',
            'VERTICALCYLINDER',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      EndShapeType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_EndShapeType',
          values: [
            'CONCAVECONVEX',
            'CONCAVEFLAT',
            'CONVEXCONVEX',
            'FLATCONVEX',
            'FLATFLAT',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      FirstCurvatureRadius: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      SecondCurvatureRadius: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      NumberOfSections: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcCountMeasure',
      },
    },
  },
  Pset_TankTypeExpansion: {
    applicable: ['IfcTank/EXPANSION', 'IfcTankType/EXPANSION'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      ChargePressure: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      PressureRegulatorSetting: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      ReliefValveSetting: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
    },
  },
  Pset_TankTypePreformed: {
    applicable: ['IfcTank', 'IfcTankType'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      PatternType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_TankPatternType',
          values: [
            'HORIZONTALCYLINDER',
            'RECTANGULAR',
            'VERTICALCYLINDER',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      EndShapeType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_EndShapeType',
          values: [
            'CONCAVECONVEX',
            'CONCAVEFLAT',
            'CONVEXCONVEX',
            'FLATCONVEX',
            'FLATFLAT',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      FirstCurvatureRadius: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      SecondCurvatureRadius: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
    },
  },
  Pset_TankTypePressureVessel: {
    applicable: ['IfcTank/PRESSUREVESSEL', 'IfcTankType/PRESSUREVESSEL'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      ChargePressure: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      PressureRegulatorSetting: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      ReliefValveSetting: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
    },
  },
  Pset_TankTypeSectional: {
    applicable: ['IfcTank', 'IfcTankType'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      NumberOfSections: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcCountMeasure',
      },
      SectionLength: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      SectionWidth: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
    },
  },
  Pset_ValveTypeAirRelease: {
    applicable: ['IfcValve/AIRRELEASE', 'IfcValveType/AIRRELEASE'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      IsAutomatic: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
    },
  },
  Pset_ValveTypeCommon: {
    applicable: ['IfcValve', 'IfcValveType'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      Reference: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcIdentifier',
      },
      Status: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_ElementStatus',
          values: ['DEMOLISH', 'EXISTING', 'NEW', 'TEMPORARY', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      ValvePattern: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_ValvePattern',
          values: [
            'ANGLED_2_PORT',
            'CROSSOVER_4_PORT',
            'SINGLEPORT',
            'STRAIGHT_2_PORT',
            'STRAIGHT_3_PORT',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      ValveOperation: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_ValveOperation',
          values: [
            'DROPWEIGHT',
            'FLOAT',
            'HYDRAULIC',
            'LEVER',
            'LOCKSHIELD',
            'MOTORIZED',
            'PNEUMATIC',
            'SOLENOID',
            'SPRING',
            'THERMOSTATIC',
            'WHEEL',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      ValveMechanism: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_ValveMechanism',
          values: [
            'BALL',
            'BUTTERFLY',
            'CONFIGUREDGATE',
            'GLAND',
            'GLOBE',
            'LUBRICATEDPLUG',
            'NEEDLE',
            'PARALLELSLIDE',
            'PLUG',
            'WEDGEGATE',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      Size: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
      TestPressure: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      WorkingPressure: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      FlowCoefficient: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcReal',
      },
      CloseOffRating: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
    },
  },
  Pset_ValveTypeDrawOffCock: {
    applicable: ['IfcValve/DRAWOFFCOCK', 'IfcValveType/DRAWOFFCOCK'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      HasHoseUnion: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
    },
  },
  Pset_ValveTypeFaucet: {
    applicable: ['IfcValve/FAUCET', 'IfcValveType/FAUCET'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      FaucetType: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_FaucetType',
          values: [
            'BIB',
            'DIVERTER',
            'DIVIDEDFLOWCOMBINATION',
            'GLOBE',
            'PILLAR',
            'SINGLEOUTLETCOMBINATION',
            'SPRAY',
            'SPRAYMIXING',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      FaucetOperation: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_FaucetOperation',
          values: [
            'CERAMICDISC',
            'LEVERHANDLE',
            'NONCONCUSSIVESELFCLOSING',
            'QUARTERTURN',
            'QUICKACTION',
            'SCREWDOWN',
            'SELFCLOSING',
            'TIMEDSELFCLOSING',
            'OTHER',
            'NOTKNOWN',
            'UNSET',
          ],
        },
      },
      FaucetFunction: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_FaucetFunction',
          values: ['COLD', 'HOT', 'MIXED', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      Finish: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcText',
      },
      FaucetTopDescription: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcText',
      },
    },
  },
  Pset_ValveTypeFlushing: {
    applicable: ['IfcValve/FLUSHING', 'IfcValveType/FLUSHING'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      FlushingRate: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcVolumetricFlowRateMeasure',
      },
      HasIntegralShutOffDevice: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
      IsHighPressure: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
    },
  },
  Pset_ValveTypeGasTap: {
    applicable: ['IfcValve/GASTAP', 'IfcValveType/GASTAP'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      HasHoseUnion: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
    },
  },
  Pset_ValveTypeIsolating: {
    applicable: ['IfcValve/ISOLATING', 'IfcValveType/ISOLATING'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      IsNormallyOpen: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcBoolean',
      },
      IsolatingPurpose: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_IsolatingPurpose',
          values: ['LANDING', 'LANDINGWITHPRESSUREREGULATION', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
    },
  },
  Pset_ValveTypeMixing: {
    applicable: ['IfcValve/MIXING', 'IfcValveType/MIXING'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      MixerControl: {
        kind: 'P_ENUMERATEDVALUE',
        type: 'IfcLabel',
        enumeration: {
          name: 'PEnum_MixingValveControl',
          values: ['MANUAL', 'PREDEFINED', 'THERMOSTATIC', 'OTHER', 'NOTKNOWN', 'UNSET'],
        },
      },
      OutletConnectionSize: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPositiveLengthMeasure',
      },
    },
  },
  Pset_ValveTypePressureReducing: {
    applicable: ['IfcValve/PRESSUREREDUCING', 'IfcValveType/PRESSUREREDUCING'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      UpstreamPressure: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
      DownstreamPressure: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
    },
  },
  Pset_ValveTypePressureRelief: {
    applicable: ['IfcValve/PRESSURERELIEF', 'IfcValveType/PRESSURERELIEF'],
    templateType: 'PSET_TYPEDRIVENOVERRIDE',
    properties: {
      ReliefPressure: {
        kind: 'P_SINGLEVALUE',
        type: 'IfcPressureMeasure',
      },
    },
  },
  Qto_FilterBaseQuantities: {
    applicable: ['IfcFilter', 'IfcFilterType'],
    templateType: 'QTO_TYPEDRIVENOVERRIDE',
    properties: {
      GrossWeight: {
        kind: 'Q_WEIGHT',
        type: null,
      },
    },
  },
  Qto_PipeFittingBaseQuantities: {
    applicable: ['IfcPipeFitting', 'IfcPipeFittingType'],
    templateType: 'QTO_TYPEDRIVENOVERRIDE',
    properties: {
      Length: {
        kind: 'Q_LENGTH',
        type: null,
      },
      GrossCrossSectionArea: {
        kind: 'Q_AREA',
        type: null,
      },
      NetCrossSectionArea: {
        kind: 'Q_AREA',
        type: null,
      },
      OuterSurfaceArea: {
        kind: 'Q_AREA',
        type: null,
      },
      GrossWeight: {
        kind: 'Q_WEIGHT',
        type: null,
      },
      NetWeight: {
        kind: 'Q_WEIGHT',
        type: null,
      },
    },
  },
  Qto_PipeSegmentBaseQuantities: {
    applicable: ['IfcPipeSegment', 'IfcPipeSegmentType'],
    templateType: 'QTO_TYPEDRIVENOVERRIDE',
    properties: {
      Length: {
        kind: 'Q_LENGTH',
        type: null,
      },
      GrossCrossSectionArea: {
        kind: 'Q_AREA',
        type: null,
      },
      NetCrossSectionArea: {
        kind: 'Q_AREA',
        type: null,
      },
      OuterSurfaceArea: {
        kind: 'Q_AREA',
        type: null,
      },
      GrossWeight: {
        kind: 'Q_WEIGHT',
        type: null,
      },
      NetWeight: {
        kind: 'Q_WEIGHT',
        type: null,
      },
      FootPrintArea: {
        kind: 'Q_AREA',
        type: null,
      },
    },
  },
  Qto_PumpBaseQuantities: {
    applicable: ['IfcPump', 'IfcPumpType'],
    templateType: 'QTO_TYPEDRIVENOVERRIDE',
    properties: {
      GrossWeight: {
        kind: 'Q_WEIGHT',
        type: null,
      },
    },
  },
  Qto_TankBaseQuantities: {
    applicable: ['IfcTank', 'IfcTankType'],
    templateType: 'QTO_TYPEDRIVENOVERRIDE',
    properties: {
      GrossWeight: {
        kind: 'Q_WEIGHT',
        type: null,
      },
      NetWeight: {
        kind: 'Q_WEIGHT',
        type: null,
      },
      TotalSurfaceArea: {
        kind: 'Q_AREA',
        type: null,
      },
    },
  },
  Qto_ValveBaseQuantities: {
    applicable: ['IfcValve', 'IfcValveType'],
    templateType: 'QTO_TYPEDRIVENOVERRIDE',
    properties: {
      GrossWeight: {
        kind: 'Q_WEIGHT',
        type: null,
      },
    },
  },
};
